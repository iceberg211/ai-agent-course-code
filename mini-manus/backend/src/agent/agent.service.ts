import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, END, START } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from './agent.state';
import { AgentCallbacks } from './agent.callbacks';
import { ToolRegistry } from '../tool/tool.registry';
import { SkillRegistry } from '../skill/skill.registry';
import { WorkspaceService } from '../workspace/workspace.service';
import { EventPublisher } from '../event/event.publisher';
import { plannerNode } from './nodes/planner.node';
import { executorNode } from './nodes/executor.node';
import { evaluatorNode } from './nodes/evaluator.node';
import { finalizerNode } from './nodes/finalizer.node';
import { RunStatus } from '../common/enums';
import { TASK_EVENTS } from '../common/events/task.events';

const MAX_RETRIES = 3;
const MAX_REPLANS = 2;
const MAX_STEPS = 20;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly llm: ChatOpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly workspace: WorkspaceService,
    private readonly eventPublisher: EventPublisher,
  ) {
    this.llm = new ChatOpenAI({
      modelName: config.get<string>('MODEL_NAME', 'gpt-4o-mini'),
      apiKey: config.get<string>('OPENAI_API_KEY', ''),
      configuration: { baseURL: config.get<string>('OPENAI_BASE_URL') },
      temperature: 0,
    });
  }

  async executeRun(
    taskId: string,
    runId: string,
    revisionInput: string,
    callbacks: AgentCallbacks,
    signal: AbortSignal,
  ): Promise<void> {
    const llm = this.llm;
    const toolRegistry = this.toolRegistry;
    const skillRegistry = this.skillRegistry;
    const workspace = this.workspace;
    const eventPublisher = this.eventPublisher;

    // Track last step_run id for evaluator
    const lastStepRunId = '';
    const lastStepOutput = '';

    // Build StateGraph
    const graph = new StateGraph(AgentStateAnnotation)
      .addNode('planner', async (state: AgentState) => {
        return plannerNode(
          state,
          llm,
          skillRegistry,
          callbacks,
          eventPublisher,
        );
      })
      .addNode('executor', async (state: AgentState) => {
        const result = await executorNode(
          state,
          llm,
          toolRegistry,
          skillRegistry,
          workspace,
          callbacks,
          eventPublisher,
          signal,
        );
        // Capture step_run id + output for evaluator (side-channel via closure)
        // In production, would pass through state; simplified here for V1
        return result;
      })
      .addNode('evaluator', async (state: AgentState) => {
        return evaluatorNode(
          state,
          llm,
          callbacks,
          eventPublisher,
          lastStepRunId,
          lastStepOutput,
        );
      })
      .addNode('finalizer', async (state: AgentState) => {
        return finalizerNode(state, llm, callbacks, eventPublisher);
      })
      .addEdge(START, 'planner')
      .addEdge('planner', 'executor')
      .addEdge('executor', 'evaluator')
      .addConditionalEdges('evaluator', (state: AgentState) => {
        if (state.shouldStop) return END;
        const eval_ = state.evaluation;
        if (!eval_) return 'executor';

        if (eval_.decision === 'complete') return 'finalizer';
        if (eval_.decision === 'fail') return END;

        if (eval_.decision === 'retry') {
          if (state.retryCount >= MAX_RETRIES) return END;
          return 'executor';
        }
        if (eval_.decision === 'replan') {
          if (state.replanCount >= MAX_REPLANS) return END;
          return 'planner';
        }
        // continue: advance step or finalize
        const nextIndex = state.currentStepIndex + 1;
        const totalSteps = state.currentPlan?.steps.length ?? 0;
        if (nextIndex >= totalSteps || state.executionOrder >= MAX_STEPS)
          return 'finalizer';
        return 'executor';
      })
      .addEdge('finalizer', END);

    const compiled = graph.compile();

    const initialState: Partial<AgentState> = {
      taskId,
      runId,
      revisionInput,
      currentPlan: null,
      currentStepIndex: 0,
      stepResults: [],
      replanCount: 0,
      retryCount: 0,
      evaluation: null,
      executionOrder: 0,
      shouldStop: false,
      errorMessage: null,
    };

    eventPublisher.emit(TASK_EVENTS.RUN_STARTED, { taskId, runId });
    await callbacks.setRunStatus(runId, RunStatus.RUNNING);

    try {
      const finalState = await compiled.invoke(initialState);

      if (finalState.shouldStop || finalState.errorMessage === 'cancelled') {
        await callbacks.setRunStatus(runId, RunStatus.CANCELLED);
        eventPublisher.emit(TASK_EVENTS.RUN_CANCELLED, { taskId, runId });
      } else if (finalState.errorMessage) {
        await callbacks.setRunStatus(
          runId,
          RunStatus.FAILED,
          finalState.errorMessage ?? undefined,
        );
        eventPublisher.emit(TASK_EVENTS.RUN_FAILED, {
          taskId,
          runId,
          error: finalState.errorMessage,
        });
      } else {
        await callbacks.setRunStatus(runId, RunStatus.COMPLETED);
        eventPublisher.emit(TASK_EVENTS.RUN_COMPLETED, { taskId, runId });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runId} failed with error: ${msg}`);
      await callbacks.setRunStatus(runId, RunStatus.FAILED, msg);
      eventPublisher.emit(TASK_EVENTS.RUN_FAILED, {
        taskId,
        runId,
        error: msg,
      });
    } finally {
      await callbacks.finalize(taskId);
    }
  }
}
