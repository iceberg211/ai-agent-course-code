import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { Command, END } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState, StepResult } from '@/agent/agent.state';
import { getCtx, type NodeContext } from '@/agent/agent.context';
import { getIntentConfig } from '@/agent/intent.config';
import { evaluatorPrompt } from '@/prompts';
import { StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import {
  DB_RESULT_SUMMARY_MAX,
  EVENT_STEP_PREVIEW_MAX,
  EVENT_REASON_MAX,
  PROMPT_HISTORY_STEP_MAX,
} from '@/common/constants/system-limits';

const logger = new Logger('CheckerNode');

// ─── Types ───────────────────────────────────────────────────────────────────

type Decision = 'continue' | 'retry' | 'replan' | 'complete' | 'fail';

interface CheckResult {
  decision: Decision;
  reason: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

// ─── Tool fallback mapping (resource_unavailable scenario) ───────────────────

const TOOL_FALLBACKS: Record<string, string> = {
  sandbox_run_node: 'think',
  sandbox_run_python: 'think',
  browser_open: 'fetch_url_as_markdown',
  browser_screenshot: 'fetch_url_as_markdown',
};

// ─── Structural error patterns (retry won't recover) ─────────────────────────

const STRUCTURAL_ERROR_PATTERNS = [
  'winansi cannot encode',
  'tool_input_invalid',
  'could not parse output',
  'outputparserexception',
  'invalid json',
  'permission denied',
  'eacces',
  'enoent',
];

const CODE_EXECUTION_FAILED = 'code_execution_failed';

function isStructuralError(lower: string): boolean {
  return STRUCTURAL_ERROR_PATTERNS.some((p) => lower.includes(p));
}

// ─── Rule-based pre-checks ───────────────────────────────────────────────────
// Return a CheckResult for deterministic cases, null to defer to LLM.

function runPreChecks(
  output: string,
  retryCount: number,
  replanCount: number,
  maxRetries: number,
  maxReplans: number,
): CheckResult | null {
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();

  // 1. resource_unavailable: degrade to fallback tool via retry
  if (lower.includes('resource_unavailable')) {
    const toolMatch = trimmed.match(/resource_unavailable[:\s]+(\w+)/i);
    const failedTool = toolMatch?.[1] ?? '';
    const fallback = TOOL_FALLBACKS[failedTool];
    if (fallback && retryCount < maxRetries) {
      logger.warn(
        `Tool ${failedTool} unavailable -> fallback to ${fallback} (retry ${retryCount + 1}/${maxRetries})`,
      );
      return {
        decision: 'retry',
        reason: `Tool ${failedTool} unavailable, falling back to ${fallback}`,
        metadata: { fallbackTool: fallback },
      };
    }
  }

  // 2. code_execution_failed: retry is pointless, replan to fix code
  if (lower.includes(CODE_EXECUTION_FAILED)) {
    if (replanCount < maxReplans) {
      return {
        decision: 'replan',
        reason: `Code execution failed (non-zero exit), replanning to fix: ${trimmed.slice(0, 300)}`,
      };
    }
    return {
      decision: 'fail',
      reason: `Code execution failed repeatedly, cannot auto-fix: ${trimmed.slice(0, 200)}`,
    };
  }

  // 3. structural errors: skip retry, go straight to replan/fail
  if (isStructuralError(lower)) {
    const decision = replanCount < maxReplans ? 'replan' : 'fail';
    logger.warn(
      `Structural error -> ${decision} | output: ${trimmed.slice(0, 120)}`,
    );
    return {
      decision,
      reason:
        decision === 'replan'
          ? `Structural error, retry won't recover, replanning: ${trimmed.slice(0, 200)}`
          : `Structural error and replans exhausted: ${trimmed.slice(0, 200)}`,
    };
  }

  // 4. Classify transient errors
  const isEmpty = trimmed.length < 10;
  const isError =
    lower.startsWith('error') ||
    lower.startsWith('failed') ||
    lower.startsWith('cannot') ||
    lower.includes('exception') ||
    lower.includes('tool_execution_failed') ||
    lower.includes('tool_input_invalid') ||
    lower.includes('artifact_generation_failed');
  const isTimeout = lower.includes('timeout') || lower.includes('\u8d85\u65f6');
  const isBadOutput = isEmpty || isError || isTimeout;

  // transient error + retries remain -> retry
  if (isBadOutput && retryCount < maxRetries) {
    logger.log(
      `retry ${retryCount + 1}/${maxRetries} | ${isEmpty ? 'empty' : isTimeout ? 'timeout' : 'error'} | ${trimmed.slice(0, 80)}`,
    );
    return {
      decision: 'retry',
      reason: `Output empty or errored, auto-retry (attempt ${retryCount + 1})`,
    };
  }

  // retries exhausted but replans remain -> replan
  if (
    (isEmpty || isError) &&
    retryCount >= maxRetries &&
    replanCount < maxReplans
  ) {
    logger.warn(
      `${maxRetries} retries exhausted -> replan | ${trimmed.slice(0, 80)}`,
    );
    return {
      decision: 'replan',
      reason: 'Multiple retries failed, auto-replanning',
    };
  }

  // all retries and replans exhausted -> fail
  if (isBadOutput && retryCount >= maxRetries && replanCount >= maxReplans) {
    return {
      decision: 'fail',
      reason: `All retries and replans exhausted: ${trimmed.slice(0, 200)}`,
    };
  }

  return null; // no rule matched -> defer to LLM
}

// ─── Build recent summaries for LLM evaluator prompt ─────────────────────────

function buildRecentSummaries(
  stepResults: StepResult[],
  maxChars = 3000,
): string {
  if (stepResults.length === 0) return 'None';
  const current = stepResults[stepResults.length - 1];
  const currentContent = (current.toolOutput ?? current.resultSummary).slice(
    0,
    Math.floor(maxChars * 0.6),
  );
  let result = `[Current] ${current.description}: ${currentContent}`;
  let remaining = maxChars - result.length;
  for (let i = stepResults.length - 2; i >= 0 && remaining > 200; i--) {
    const s = stepResults[i];
    const content = (s.toolOutput ?? s.resultSummary ?? '').slice(
      0,
      PROMPT_HISTORY_STEP_MAX,
    );
    const line = `[Step${s.executionOrder + 1}] ${s.description}: ${content}`;
    if (line.length > remaining) break;
    result = line + '\n' + result;
    remaining -= line.length;
  }
  return result;
}

// ─── LLM evaluation schema ──────────────────────────────────────────────────

const EvalSchema = z.object({
  decision: z.enum(['continue', 'retry', 'replan', 'complete', 'fail']),
  reason: z.string(),
});

// ─── Main node ───────────────────────────────────────────────────────────────

export async function checkerNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Command> {
  const ctx = getCtx(config);
  const lastStepRunId = state.lastStepRunId;
  const lastOutput = state.lastOutput;

  // ─── 1. Cancel check ─────────────────────────────────────────────────────
  const cancelled = await ctx.callbacks.readCancelFlag(state.runId);
  if (cancelled) {
    if (lastStepRunId) {
      await ctx.callbacks.updateStepRun(lastStepRunId, {
        status: StepStatus.FAILED,
        errorMessage: 'Task cancelled',
        completedAt: new Date(),
      });
      ctx.eventPublisher.emit(TASK_EVENTS.STEP_FAILED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: lastStepRunId,
        error: 'Task cancelled',
      });
    }
    return new Command({ update: { error: 'cancelled' }, goto: END });
  }

  // ─── 2. Token budget check ────────────────────────────────────────────────
  const budgetFailure = ctx.tokenBudgetGuard.check();
  if (budgetFailure) {
    return await applyDecision(
      {
        decision: 'fail',
        reason: budgetFailure.reason,
        errorCode: budgetFailure.errorCode,
        metadata: budgetFailure.metadata,
      },
      state,
      ctx,
      true,
    );
  }

  if (!state.plan) {
    return new Command({ update: { error: 'No valid plan' }, goto: END });
  }

  // ─── 3. Rule-based pre-checks ─────────────────────────────────────────────
  const preCheck = runPreChecks(
    lastOutput,
    state.retryCount,
    state.replanCount,
    ctx.maxRetries,
    ctx.maxReplans,
  );
  if (preCheck !== null) {
    return await applyDecision(preCheck, state, ctx, true);
  }

  // ─── 4. Deterministic workflow fast-track (skip LLM call) ─────────────────
  const intentConfig = getIntentConfig(state.intent);
  if (intentConfig.deterministicCheck) {
    const totalSteps = state.plan.steps.length;
    const isLastStep = state.stepIndex >= totalSteps - 1;
    const fastDecision: CheckResult = {
      decision: isLastStep ? 'complete' : 'continue',
      reason: `Deterministic workflow step ${state.stepIndex + 1}/${totalSteps} completed`,
    };
    logger.log(
      `Deterministic fast-track -> ${fastDecision.decision} (step ${state.stepIndex + 1}/${totalSteps})`,
    );
    return await applyDecision(fastDecision, state, ctx, true);
  }

  // ─── 5. LLM evaluation (dynamic paths: general, content_writing) ──────────
  const currentStep = state.plan.steps[state.stepIndex];
  const recentSummaries = buildRecentSummaries(state.stepResults);
  const chain = evaluatorPrompt.pipe(
    ctx.llm.withStructuredOutput(EvalSchema, { method: ctx.soMethod }),
  );
  const result = (await chain.invoke({
    stepDescription: currentStep?.description ?? 'unknown',
    lastStepOutput: lastOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    recentSummaries,
    retryCount: String(state.retryCount),
    replanCount: String(state.replanCount),
  })) as CheckResult;

  logger.log(
    `LLM evaluation -> ${result.decision} | ${result.reason.slice(0, 80)}`,
  );

  return await applyDecision(result, state, ctx, false);
}

// ─── Apply decision: persist step_run terminal status + emit events + Command ─

async function applyDecision(
  result: CheckResult,
  state: AgentState,
  ctx: NodeContext,
  viaPreCheck: boolean,
): Promise<Command> {
  const lastStepRunId = state.lastStepRunId;
  const lastOutput = state.lastOutput;
  const currentStep = state.plan?.steps[state.stepIndex];

  // Emit EVALUATOR_DECIDED for all branches (debug/observability)
  ctx.eventPublisher.emit(TASK_EVENTS.EVALUATOR_DECIDED, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId: lastStepRunId,
    input: {
      lastStepOutputPreview: lastOutput.slice(0, EVENT_STEP_PREVIEW_MAX),
      retryCount: state.retryCount,
      replanCount: state.replanCount,
      currentStepIndex: state.stepIndex,
    },
    viaPreCheck,
    decision: result.decision,
    reason: result.reason.slice(0, EVENT_REASON_MAX),
    errorCode: result.errorCode ?? null,
  });

  // ─── Update step_run to terminal status (awaited for correctness) ────────
  if (lastStepRunId) {
    if (result.decision === 'retry' || result.decision === 'fail') {
      await ctx.callbacks.updateStepRun(lastStepRunId, {
        status: StepStatus.FAILED,
        errorMessage: result.reason,
        completedAt: new Date(),
      });
      ctx.eventPublisher.emit(TASK_EVENTS.STEP_FAILED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: lastStepRunId,
        error: result.reason,
        errorCode: result.errorCode ?? null,
        metadata: result.metadata ?? null,
      });
    } else {
      await ctx.callbacks.updateStepRun(lastStepRunId, {
        status: StepStatus.COMPLETED,
        resultSummary: result.reason,
        completedAt: new Date(),
      });
      ctx.eventPublisher.emit(TASK_EVENTS.STEP_COMPLETED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: lastStepRunId,
        resultSummary: result.reason,
      });
    }
  }

  // ─── Build StepResult (used by continue/replan/complete) ─────────────────
  const newStepResult: StepResult = {
    stepRunId: lastStepRunId,
    description: currentStep?.description ?? '',
    resultSummary: lastOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    toolOutput: lastOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    executionOrder: state.executionOrder - 1,
  };

  // ─── Route via Command ───────────────────────────────────────────────────
  switch (result.decision) {
    case 'retry':
      // Preserve lastOutput (don't clear) — executor reads it for retry hint
      return new Command({
        update: {
          lastStepRunId: '',
          retryCount: state.retryCount + 1,
        },
        goto: 'executor',
      });

    case 'continue':
      return new Command({
        update: {
          lastStepRunId: '',
          lastOutput: '',
          stepIndex: state.stepIndex + 1,
          retryCount: 0,
          stepResults: [newStepResult],
        },
        goto: 'executor',
      });

    case 'replan':
      return new Command({
        update: {
          lastStepRunId: '',
          lastOutput: '',
          replanCount: state.replanCount + 1,
          retryCount: 0,
          stepResults: [newStepResult],
        },
        goto: 'planner',
      });

    case 'complete':
      return new Command({
        update: {
          lastStepRunId: '',
          lastOutput: '',
          stepResults: [newStepResult],
        },
        goto: 'finalizer',
      });

    case 'fail':
    default:
      return new Command({
        update: { error: result.reason },
        goto: END,
      });
  }
}
