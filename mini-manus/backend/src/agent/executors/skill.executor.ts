import { Logger } from '@nestjs/common';
import type { AgentState } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';
import { ExecutorType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import {
  withTimeout,
  persistStepOutput,
  resolveStepResultsInRecord,
} from './shared';

const logger = new Logger('SkillExecutor');

export interface SkillExecutorResult {
  output: string;
  structuredData?: unknown;
}

export async function executeSkillStep(
  state: AgentState,
  ctx: NodeContext,
  step: {
    description: string;
    skillName: string;
    skillInput?: Record<string, unknown> | null;
  },
  stepRunId: string,
): Promise<SkillExecutorResult> {
  const skill = ctx.skillRegistry.get(step.skillName);
  const skillTrace: Array<{ tool: string; input: unknown; output: string }> =
    [];
  let finalOutput: unknown = null;

  const resolvedInput = resolveStepResultsInRecord(
    step.skillInput ?? {},
    state.stepResults,
  );

  await withTimeout(
    (async () => {
      for await (const event of skill.execute(resolvedInput, {
        tools: ctx.toolRegistry,
        llm: ctx.llm,
        workspace: ctx.workspace,
        signal: ctx.signal,
        soMethod: ctx.soMethod,
        taskId: state.taskId,
        priorStepSummaries: state.stepResults.map((s) => s.description),
      })) {
        if (event.type === 'tool_call') {
          ctx.eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
            taskId: state.taskId,
            runId: state.runId,
            stepRunId,
            toolName: event.tool,
            toolInput: event.input as Record<string, unknown>,
          });
          skillTrace.push({ tool: event.tool, input: event.input, output: '' });
        } else if (event.type === 'tool_result') {
          if (skillTrace.length > 0)
            skillTrace[skillTrace.length - 1].output = event.output;
          ctx.eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
            taskId: state.taskId,
            runId: state.runId,
            stepRunId,
            toolName: event.tool,
            toolOutput: event.output,
            cached: event.cached ?? false,
            error: event.error ?? null,
            errorCode: event.errorCode ?? null,
          });
        } else if (event.type === 'progress') {
          ctx.eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
            taskId: state.taskId,
            runId: state.runId,
            stepRunId,
            planStepId: '',
            message: event.message,
          });
        } else if (event.type === 'result') {
          finalOutput = event.output;
        }
        if (ctx.signal.aborted) break;
      }
    })(),
    ctx.skillTimeoutMs,
  );

  const resultSummary =
    typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput);

  await ctx.callbacks.updateStepRun(stepRunId, {
    executorType: ExecutorType.SKILL,
    skillName: step.skillName,
    skillTrace,
    resultSummary,
    completedAt: new Date(),
  });

  await persistStepOutput(
    ctx.workspace,
    state.taskId,
    state.executionOrder,
    step.skillName,
    step.description,
    resultSummary,
    typeof finalOutput === 'object' && finalOutput !== null
      ? finalOutput
      : undefined,
  );

  return { output: resultSummary };
}
