import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { InMemoryCache } from '@langchain/core/caches';
import { StateGraph, END, START } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { EventPublisher } from '@/event/event.publisher';
import { plannerNode } from '@/agent/nodes/planner.node';
import { executorNode } from '@/agent/nodes/executor.node';
import { evaluatorNode } from '@/agent/nodes/evaluator.node';
import { finalizerNode } from '@/agent/nodes/finalizer.node';
import { RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { TokenTrackerCallback } from '@/agent/token-tracker.callback';

function readBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly llm: ChatOpenAI;
  private readonly maxRetries: number;
  private readonly maxReplans: number;
  private readonly maxSteps: number;
  private readonly stepTimeoutMs: number;
  private readonly exportPdfEnabled: boolean;
  /**
   * 结构化输出方式：
   * - 'functionCalling'  通用，兼容 Qwen / Ollama / Azure 等
   * - 'json_schema'      OpenAI 原生 Structured Outputs，更严格但仅 gpt-4o 支持完整
   * - 'jsonMode'         response_format=json_object，最宽松，适合不支持函数调用的模型
   *
   * 通过 STRUCTURED_OUTPUT_METHOD 环境变量覆盖，默认 functionCalling。
   */
  readonly structuredOutputMethod:
    | 'functionCalling'
    | 'json_schema'
    | 'jsonMode';

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly workspace: WorkspaceService,
    private readonly eventPublisher: EventPublisher,
  ) {
    const llmCacheEnabled = readBoolean(
      config.get<string>('LLM_CACHE_ENABLED'),
      true,
    );
    this.llm = new ChatOpenAI({
      modelName: config.get<string>('MODEL_NAME', 'gpt-4o-mini'),
      apiKey: config.get<string>('OPENAI_API_KEY', ''),
      configuration: { baseURL: config.get<string>('OPENAI_BASE_URL') },
      temperature: 0,
      cache: llmCacheEnabled ? new InMemoryCache() : undefined,
    });
    this.maxRetries = config.get<number>('MAX_RETRIES', 3);
    this.maxReplans = config.get<number>('MAX_REPLANS', 2);
    this.maxSteps = config.get<number>('MAX_STEPS', 20);
    this.stepTimeoutMs = config.get<number>('STEP_TIMEOUT_MS', 60_000);
    this.exportPdfEnabled = readBoolean(
      config.get<string>('EXPORT_PDF_ENABLED'),
      false,
    );

    const raw = config.get<string>(
      'STRUCTURED_OUTPUT_METHOD',
      'functionCalling',
    );
    this.structuredOutputMethod = (
      ['functionCalling', 'json_schema', 'jsonMode'].includes(raw)
        ? raw
        : 'functionCalling'
    ) as this['structuredOutputMethod'];

    this.logger.log(`Structured output method: ${this.structuredOutputMethod}`);
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
    const soMethod = this.structuredOutputMethod;

    // Build StateGraph
    const graph = new StateGraph(AgentStateAnnotation)
      .addNode('planner', async (state: AgentState) => {
        return plannerNode(
          state,
          llm,
          skillRegistry,
          toolRegistry,
          callbacks,
          eventPublisher,
          soMethod,
        );
      })
      .addNode('executor', async (state: AgentState) => {
        return executorNode(
          state,
          llm,
          toolRegistry,
          skillRegistry,
          workspace,
          callbacks,
          eventPublisher,
          signal,
          this.stepTimeoutMs,
        );
      })
      .addNode('evaluator', async (state: AgentState) => {
        return evaluatorNode(
          state,
          llm,
          callbacks,
          eventPublisher,
          soMethod,
          this.maxRetries,
          this.maxReplans,
        );
      })
      .addNode('finalizer', async (state: AgentState) => {
        return finalizerNode(
          state,
          llm,
          callbacks,
          eventPublisher,
          this.exportPdfEnabled,
          soMethod,
        );
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
          if (state.retryCount >= this.maxRetries) return END;
          return 'executor';
        }
        if (eval_.decision === 'replan') {
          if (state.replanCount >= this.maxReplans) return END;
          return 'planner';
        }
        // continue: advance step or finalize
        const nextIndex = state.currentStepIndex + 1;
        const totalSteps = state.currentPlan?.steps.length ?? 0;
        if (nextIndex >= totalSteps || state.executionOrder >= this.maxSteps)
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

    const tokenTracker = new TokenTrackerCallback();

    try {
      const finalState = await compiled.invoke(initialState, {
        callbacks: [tokenTracker],
      });

      // 检测因重试/重规划/fail 耗尽而退出的情况：
      // evaluator 返回 END 时不设 errorMessage，若不主动识别会被误判为 completed
      const decision = finalState.evaluation?.decision;
      const isExhausted =
        decision === 'fail' ||
        (decision === 'retry' && finalState.retryCount >= this.maxRetries) ||
        (decision === 'replan' && finalState.replanCount >= this.maxReplans);

      if (finalState.shouldStop || finalState.errorMessage === 'cancelled') {
        await callbacks.setRunStatus(runId, RunStatus.CANCELLED);
        eventPublisher.emit(TASK_EVENTS.RUN_CANCELLED, { taskId, runId });
      } else if (finalState.errorMessage || isExhausted) {
        const msg =
          finalState.errorMessage ??
          finalState.evaluation?.reason ??
          (decision === 'retry'
            ? `重试次数已耗尽（上限 ${this.maxRetries}）`
            : decision === 'replan'
              ? `重规划次数已耗尽（上限 ${this.maxReplans}）`
              : '任务执行失败');
        await callbacks.setRunStatus(runId, RunStatus.FAILED, msg);
        eventPublisher.emit(TASK_EVENTS.RUN_FAILED, {
          taskId,
          runId,
          error: msg,
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
      // Emit token usage regardless of run outcome
      if (tokenTracker.totalTokens > 0) {
        this.logger.log(
          `Run ${runId} token usage — in: ${tokenTracker.inputTokens}, out: ${tokenTracker.outputTokens}, total: ${tokenTracker.totalTokens}`,
        );
        eventPublisher.emit(TASK_EVENTS.RUN_TOKEN_USAGE, {
          taskId,
          runId,
          inputTokens: tokenTracker.inputTokens,
          outputTokens: tokenTracker.outputTokens,
          totalTokens: tokenTracker.totalTokens,
        });
      }
      await callbacks.finalize(taskId);
    }
  }
}
