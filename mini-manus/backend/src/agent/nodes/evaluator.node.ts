import { Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, EvaluationResult, StepResult } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { evaluatorPrompt } from '@/prompts';
import { TokenBudgetGuard } from '@/agent/token-budget.guard';

const logger = new Logger('EvaluatorNode');

const EvalSchema = z.object({
  decision: z.enum(['continue', 'retry', 'replan', 'complete', 'fail']),
  reason: z.string(),
});

// ─── 结构性错误：重试不会恢复，跳过重试直接 replan/fail ──────────────────────
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

/**
 * code_execution_failed：沙箱执行代码返回非零退出码。
 * 重试（retry）没有意义——同一份有 bug 的代码会继续失败。
 * 应该直接 replan，让 Planner 重新规划、修复代码。
 */
const CODE_EXECUTION_FAILED = 'code_execution_failed';

function isStructuralError(lower: string): boolean {
  return STRUCTURAL_ERROR_PATTERNS.some((p) => lower.includes(p));
}

// ─── 规则前置检查 ─────────────────────────────────────────────────────────────
// 对明显结果直接返回决策，跳过 LLM 调用，避免浪费 token
// 返回 null 表示无法确定，需要 LLM 来判断

function runPreChecks(
  output: string,
  retryCount: number,
  replanCount: number,
  maxRetries: number,
  maxReplans: number,
): EvaluationResult | null {
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();

  const isEmpty = trimmed.length < 10;
  const isError =
    lower.startsWith('error') ||
    lower.startsWith('failed') ||
    lower.startsWith('cannot') ||
    lower.includes('exception') ||
    lower.includes('tool_execution_failed') ||
    lower.includes('tool_input_invalid') ||
    lower.includes('artifact_generation_failed');
  const isTimeout = lower.includes('超时') || lower.includes('timeout');

  const structural = isStructuralError(lower);

  // 代码执行失败（沙箱 exitCode≠0）：retry 无意义，直接 replan 让 Planner 修复代码
  if (lower.includes(CODE_EXECUTION_FAILED)) {
    if (replanCount < maxReplans) {
      return {
        decision: 'replan',
        reason: `代码执行失败（exitCode 非零），需要重新规划以修复代码：${trimmed.slice(0, 300)}`,
      };
    }
    return {
      decision: 'fail',
      reason: `代码多次执行失败，无法自动修复：${trimmed.slice(0, 200)}`,
    };
  }

  // 结构性错误：重试无意义，直接 replan 或 fail（不要求 isError 门控）
  if (structural) {
    const decision = replanCount < maxReplans ? 'replan' : 'fail';
    logger.warn(`结构性错误 → ${decision} | output: ${trimmed.slice(0, 120)}`);
    if (decision === 'replan') {
      return {
        decision: 'replan',
        reason: `结构性错误，重试无法恢复，直接重新规划：${trimmed.slice(0, 200)}`,
      };
    }
    return {
      decision: 'fail',
      reason: `结构性错误且重规划已耗尽：${trimmed.slice(0, 200)}`,
    };
  }

  const isBadOutput = isEmpty || isError || isTimeout || structural;

  // 瞬态错误 + 还有重试次数 → retry
  if (isBadOutput && retryCount < maxRetries) {
    logger.log(
      `retry ${retryCount + 1}/${maxRetries} | ${isEmpty ? 'empty' : isTimeout ? 'timeout' : 'error'} | ${trimmed.slice(0, 80)}`,
    );
    return {
      decision: 'retry',
      reason: `输出为空或出错，自动重试（第 ${retryCount + 1} 次）`,
    };
  }

  // 重试耗尽 + 还有重规划次数 → replan
  if (
    (isEmpty || isError) &&
    retryCount >= maxRetries &&
    replanCount < maxReplans
  ) {
    logger.warn(
      `重试 ${maxRetries} 次仍失败 → replan | ${trimmed.slice(0, 80)}`,
    );
    return { decision: 'replan', reason: '多次重试后仍未成功，自动重新规划' };
  }

  return null; // 无明确规则 → 交给 LLM 判断
}

// ─── 决策应用（规则路径和 LLM 路径共用）─────────────────────────────────────
// 收口 step_run 终态 + 发事件 + 构建 state return

async function applyDecision(
  result: EvaluationResult,
  state: AgentState,
  lastStepRunId: string,
  lastStepOutput: string,
  currentStep: { description: string } | undefined,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
): Promise<Partial<AgentState>> {
  // 1. 更新 step_run 终态并发事件
  if (result.decision === 'retry' || result.decision === 'fail') {
    if (lastStepRunId) {
      await callbacks.updateStepRun(lastStepRunId, {
        status: StepStatus.FAILED,
        errorMessage: result.reason,
        completedAt: new Date(),
      });
      eventPublisher.emit(TASK_EVENTS.STEP_FAILED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: lastStepRunId,
        error: result.reason,
        errorCode: result.errorCode ?? null,
        metadata: result.metadata ?? null,
      });
    }
  } else {
    if (lastStepRunId) {
      await callbacks.updateStepRun(lastStepRunId, {
        status: StepStatus.COMPLETED,
        resultSummary: result.reason,
        completedAt: new Date(),
      });
      eventPublisher.emit(TASK_EVENTS.STEP_COMPLETED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: lastStepRunId,
        resultSummary: result.reason,
      });
    }
  }

  // 2. 构建 state 更新
  const newStepResult: StepResult = {
    stepRunId: lastStepRunId,
    description: currentStep?.description ?? '',
    resultSummary: result.reason,
    // 保留真实工具输出（截断），供后续步骤 Tool Calling 读取 URL/内容等数据
    toolOutput: lastStepOutput.slice(0, 1000),
    executionOrder: state.executionOrder - 1,
  };

  const baseUpdate: Partial<AgentState> = {
    evaluation: result,
    lastStepRunId: '',
    lastStepOutput: '',
  };

  if (result.decision === 'continue') {
    return {
      ...baseUpdate,
      currentStepIndex: state.currentStepIndex + 1,
      retryCount: 0,
      stepResults: [newStepResult],
    };
  }
  if (result.decision === 'retry') {
    // 保留 lastStepOutput 不清空 —— executor 重试时用它作为上下文，
    // 让 Tool Calling LLM 看到前次失败原因，选择不同的参数
    return {
      evaluation: result,
      lastStepRunId: '',
      retryCount: state.retryCount + 1,
    };
  }
  if (result.decision === 'replan') {
    return {
      ...baseUpdate,
      replanCount: state.replanCount + 1,
      retryCount: 0,
      stepResults: [newStepResult],
    };
  }
  if (result.decision === 'complete') {
    return { ...baseUpdate, stepResults: [newStepResult] };
  }
  return baseUpdate; // fail
}

// ─── Main node ────────────────────────────────────────────────────────────────

export async function evaluatorNode(
  state: AgentState,
  llm: ChatOpenAI,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode' = 'functionCalling',
  maxRetries = 3,
  maxReplans = 2,
  tokenBudgetGuard?: TokenBudgetGuard,
): Promise<Partial<AgentState>> {
  const lastStepRunId = state.lastStepRunId;
  const lastStepOutput = state.lastStepOutput;

  // 1. 取消检查
  const cancelled = await callbacks.readCancelFlag(state.runId);
  if (cancelled) {
    if (lastStepRunId) {
      await callbacks.updateStepRun(lastStepRunId, {
        status: StepStatus.FAILED,
        errorMessage: '任务已取消',
        completedAt: new Date(),
      });
      eventPublisher.emit(TASK_EVENTS.STEP_FAILED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: lastStepRunId,
        error: '任务已取消',
      });
    }
    return { shouldStop: true, errorMessage: 'cancelled' };
  }

  if (!state.currentPlan) {
    return { evaluation: { decision: 'fail', reason: '无有效计划' } };
  }

  const currentStep = state.currentPlan.steps[state.currentStepIndex];

  const budgetFailure = tokenBudgetGuard?.check();
  if (budgetFailure) {
    return applyDecision(
      budgetFailure,
      state,
      lastStepRunId,
      lastStepOutput,
      currentStep,
      callbacks,
      eventPublisher,
    );
  }

  // 2. 规则前置检查 — 明显结果直接决策，不调用 LLM
  const preCheck = runPreChecks(
    lastStepOutput,
    state.retryCount,
    state.replanCount,
    maxRetries,
    maxReplans,
  );
  if (preCheck !== null) {
    return applyDecision(
      preCheck,
      state,
      lastStepRunId,
      lastStepOutput,
      currentStep,
      callbacks,
      eventPublisher,
    );
  }

  // 3. LLM 评估 — 处理无法规则判断的情况
  const recentSummaries =
    state.stepResults
      .slice(-3)
      .map((s) => s.resultSummary)
      .join('\n') || '无';

  const chain = evaluatorPrompt.pipe(
    llm.withStructuredOutput(EvalSchema, { method: soMethod }),
  );
  const result = (await chain.invoke({
    stepDescription: currentStep?.description ?? '未知',
    lastStepOutput: lastStepOutput.slice(0, 1000),
    recentSummaries,
    retryCount: String(state.retryCount),
    replanCount: String(state.replanCount),
  })) as EvaluationResult;

  logger.log(`LLM 评估 → ${result.decision} | ${result.reason.slice(0, 80)}`);

  return applyDecision(
    result,
    state,
    lastStepRunId,
    lastStepOutput,
    currentStep,
    callbacks,
    eventPublisher,
  );
}
