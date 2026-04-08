import { ChatOpenAI } from '@langchain/openai';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { ExecutorType, StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';

const STEP_TIMEOUT_MS = 60_000;

/** 给任意 Promise 加超时，超时视为可重试错误 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`步骤执行超时（${ms / 1000}s）`)), ms),
    ),
  ]);
}

export async function executorNode(
  state: AgentState,
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  skillRegistry: SkillRegistry,
  workspace: WorkspaceService,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  signal: AbortSignal,
): Promise<Partial<AgentState>> {
  if (!state.currentPlan) throw new Error('No plan available');

  const step = state.currentPlan.steps[state.currentStepIndex];
  if (!step) throw new Error(`No step at index ${state.currentStepIndex}`);

  const usesSkill = Boolean(
    step.skillName && skillRegistry.has(step.skillName),
  );

  // 先持久化 step_run，再发事件，避免前端收到数据库里不存在的记录
  const stepRun = await callbacks.createStepRun(
    state.runId,
    `${state.currentPlan.planId}:${step.stepIndex}`,
    state.executionOrder,
  );
  await callbacks.updateStepRun(stepRun.id, {
    startedAt: new Date(),
    status: StepStatus.RUNNING,
  });

  eventPublisher.emit(TASK_EVENTS.STEP_STARTED, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId: stepRun.id,
    planStepId: stepRun.planStepId,
    description: step.description,
    executorType: usesSkill ? ExecutorType.SKILL : ExecutorType.TOOL,
    skillName: usesSkill ? step.skillName : null,
    toolName: usesSkill ? null : (step.toolHint ?? 'think'),
  });

  try {
    if (usesSkill) {
      // ─── Skill 路径 ──────────────────────────────────────────────────────
      const skill = skillRegistry.get(step.skillName!);
      const skillTrace: Array<{
        tool: string;
        input: unknown;
        output: string;
      }> = [];
      let finalOutput: unknown = null;

      await withTimeout(
        (async () => {
          for await (const event of skill.execute(step.skillInput ?? {}, {
            tools: toolRegistry,
            llm,
            workspace,
            signal,
          })) {
            if (event.type === 'tool_call') {
              eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
                taskId: state.taskId,
                runId: state.runId,
                stepRunId: stepRun.id,
                toolName: event.tool,
                toolInput: event.input as Record<string, unknown>,
              });
              skillTrace.push({
                tool: event.tool,
                input: event.input,
                output: '',
              });
            } else if (event.type === 'tool_result') {
              if (skillTrace.length > 0) {
                skillTrace[skillTrace.length - 1].output = event.output;
              }
              eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
                taskId: state.taskId,
                runId: state.runId,
                stepRunId: stepRun.id,
                toolName: event.tool,
                toolOutput: event.output,
              });
            } else if (event.type === 'progress') {
              eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
                taskId: state.taskId,
                runId: state.runId,
                stepRunId: stepRun.id,
                planStepId: stepRun.planStepId,
                message: event.message,
              });
            } else if (event.type === 'result') {
              finalOutput = event.output;
            }

            if (signal.aborted) break;
          }
        })(),
        STEP_TIMEOUT_MS,
      );

      const resultSummary =
        typeof finalOutput === 'string'
          ? finalOutput
          : JSON.stringify(finalOutput);

      await callbacks.updateStepRun(stepRun.id, {
        executorType: ExecutorType.SKILL,
        skillName: step.skillName,
        skillTrace,
        resultSummary,
        completedAt: new Date(),
      });

      return {
        executionOrder: state.executionOrder + 1,
        evaluation: null,
        lastStepRunId: stepRun.id,
        lastStepOutput: resultSummary,
      };
    } else {
      // ─── Tool 路径 ────────────────────────────────────────────────────────
      const toolName = step.toolHint ?? 'think';
      const tool = toolRegistry.get(toolName);
      const toolInput = step.toolInput ?? { thought: step.description };

      eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: stepRun.id,
        toolName,
        toolInput,
      });

      const toolResult = await withTimeout(
        tool.execute(toolInput),
        STEP_TIMEOUT_MS,
      );

      eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: stepRun.id,
        toolName,
        toolOutput: toolResult.output,
      });

      const resultSummary = toolResult.success
        ? toolResult.output.slice(0, 500)
        : (toolResult.error ?? '工具执行失败');

      await callbacks.updateStepRun(stepRun.id, {
        executorType: ExecutorType.TOOL,
        toolName,
        toolInput,
        toolOutput: toolResult.output,
        resultSummary,
        errorMessage: toolResult.success ? null : (toolResult.error ?? null),
        completedAt: new Date(),
      });

      return {
        executionOrder: state.executionOrder + 1,
        evaluation: null,
        lastStepRunId: stepRun.id,
        lastStepOutput: toolResult.output,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await callbacks.updateStepRun(stepRun.id, {
      status: StepStatus.FAILED,
      errorMessage: msg,
      completedAt: new Date(),
    });
    return {
      executionOrder: state.executionOrder + 1,
      evaluation: { decision: 'retry', reason: msg },
      lastStepRunId: stepRun.id,
      lastStepOutput: msg,
    };
  }
}
