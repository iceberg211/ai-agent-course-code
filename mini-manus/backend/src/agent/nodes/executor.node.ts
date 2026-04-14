import { Logger } from '@nestjs/common';
import { interrupt } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState, PlanStepDef } from '@/agent/agent.state';
import { getCtx, type NodeContext } from '@/agent/agent.context';
import { executeToolStep } from '@/agent/executors/tool.executor';
import { executeSkillStep } from '@/agent/executors/skill.executor';
import { executeSubAgentStep } from '@/agent/executors/subagent.executor';
import { StepStatus, RunStatus, ExecutorType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';

const logger = new Logger('ExecutorNode');

export async function executorNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Partial<AgentState>> {
  const ctx = getCtx(config);

  if (!state.plan) throw new Error('No plan available');
  const step = state.plan.steps[state.stepIndex];
  if (!step) throw new Error(`No step at index ${state.stepIndex}`);

  // ─── Determine executor type ────────────────────────────────────────────
  const usesSubAgent = Boolean(step.subAgent);
  const usesSkill =
    !usesSubAgent &&
    Boolean(step.skillName && ctx.skillRegistry.has(step.skillName));

  // ─── HITL interrupt check ───────────────────────────────────────────────
  const isSideEffect = resolveSideEffect(step, usesSubAgent, usesSkill, ctx);
  const shouldPause =
    state.approvalMode === 'all_steps' ||
    (state.approvalMode === 'side_effects' && isSideEffect);

  if (shouldPause) {
    const decision = interrupt({
      stepIndex: state.stepIndex,
      description: step.description,
      isSideEffect,
      toolOrSkill:
        step.subAgent ?? step.skillName ?? step.toolHint ?? 'unknown',
    });
    await ctx.callbacks.setRunStatus(state.runId, RunStatus.RUNNING);
    if (decision === 'rejected') {
      return { error: 'step_rejected' };
    }
  }

  // ─── Create step_run + emit STEP_STARTED ────────────────────────────────
  const stepRun = await ctx.callbacks.createStepRun(
    state.runId,
    `${state.plan.planId}:${step.stepIndex}`,
    state.executionOrder,
  );
  await ctx.callbacks.updateStepRun(stepRun.id, {
    startedAt: new Date(),
    status: StepStatus.RUNNING,
  });
  ctx.eventPublisher.emit(TASK_EVENTS.STEP_STARTED, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId: stepRun.id,
    planStepId: `${state.plan.planId}:${step.stepIndex}`,
    description: step.description,
    executorType:
      usesSubAgent || usesSkill ? ExecutorType.SKILL : ExecutorType.TOOL,
    skillName: usesSubAgent
      ? `subagent:${step.subAgent}`
      : usesSkill
        ? step.skillName
        : null,
    toolName: !usesSubAgent && !usesSkill ? (step.toolHint ?? 'think') : null,
  });

  // ─── Dispatch to the appropriate executor ───────────────────────────────
  try {
    let output: string;

    if (usesSubAgent) {
      const result = await executeSubAgentStep(
        state,
        ctx,
        step as { description: string; subAgent: string; objective?: string | null },
        stepRun.id,
      );
      output = result.output;
    } else if (usesSkill) {
      const result = await executeSkillStep(
        state,
        ctx,
        step as { description: string; skillName: string; skillInput?: Record<string, unknown> | null },
        stepRun.id,
      );
      output = result.output;
    } else {
      const result = await executeToolStep(state, ctx, step, stepRun.id);
      output = result.output;
    }

    logger.log(
      `step[${state.stepIndex}] completed | ${output.slice(0, 80)}`,
    );

    return {
      lastStepRunId: stepRun.id,
      lastOutput: output,
      executionOrder: state.executionOrder + 1,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`step[${state.stepIndex}] error: ${msg.slice(0, 200)}`);
    await ctx.callbacks.updateStepRun(stepRun.id, {
      status: StepStatus.FAILED,
      errorMessage: msg,
      completedAt: new Date(),
    });
    return {
      lastStepRunId: stepRun.id,
      lastOutput: msg,
      executionOrder: state.executionOrder + 1,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSideEffect(
  step: PlanStepDef,
  usesSubAgent: boolean,
  usesSkill: boolean,
  ctx: NodeContext,
): boolean {
  if (usesSubAgent) {
    return (
      ctx.subAgentRegistry.get(step.subAgent!)?.isSideEffect ??
      step.subAgent === 'writer'
    );
  }
  if (usesSkill) {
    return ctx.skillRegistry.get(step.skillName!).effect === 'side-effect';
  }
  if (step.toolHint && ctx.toolRegistry.has(step.toolHint)) {
    return ctx.toolRegistry.get(step.toolHint).type === 'side-effect';
  }
  return false;
}
