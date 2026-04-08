import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, EvaluationResult, StepResult } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { evaluatorPrompt } from '@/prompts';

const EvalSchema = z.object({
  decision: z.enum(['continue', 'retry', 'replan', 'complete', 'fail']),
  reason: z.string(),
});

// ─── 规则前置检查 ─────────────────────────────────────────────────────────────
// 对明显结果直接返回决策，跳过 LLM 调用，避免浪费 token
// 返回 null 表示无法确定，需要 LLM 来判断

function runPreChecks(
  output: string,
  retryCount: number,
  replanCount: number,
): EvaluationResult | null {
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();

  const isEmpty = trimmed.length < 10;
  const isError =
    lower.startsWith('error') ||
    lower.startsWith('failed') ||
    lower.startsWith('cannot') ||
    lower.includes('exception');
  const isTimeout = lower.includes('超时') || lower.includes('timeout');
  const isBadOutput = isEmpty || isError || isTimeout;

  // 空/错误/超时 + 还有重试次数 → 直接 retry
  if (isBadOutput && retryCount < 2) {
    return {
      decision: 'retry',
      reason: `输出为空或出错，自动重试（第 ${retryCount + 1} 次）`,
    };
  }

  // 空/错误 + 重试耗尽 + 还有重规划次数 → 直接 replan
  if ((isEmpty || isError) && retryCount >= 2 && replanCount < 2) {
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
    return { ...baseUpdate, retryCount: state.retryCount + 1 };
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
    }
    return { shouldStop: true, errorMessage: 'cancelled' };
  }

  if (!state.currentPlan) {
    return { evaluation: { decision: 'fail', reason: '无有效计划' } };
  }

  const currentStep = state.currentPlan.steps[state.currentStepIndex];

  // 2. 规则前置检查 — 明显结果直接决策，不调用 LLM
  const preCheck = runPreChecks(lastStepOutput, state.retryCount, state.replanCount);
  if (preCheck !== null) {
    return applyDecision(preCheck, state, lastStepRunId, currentStep, callbacks, eventPublisher);
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

  return applyDecision(result, state, lastStepRunId, currentStep, callbacks, eventPublisher);
}
