import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, EvaluationResult } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';

const EvalSchema = z.object({
  decision: z.enum(['continue', 'retry', 'replan', 'complete', 'fail']),
  reason: z.string(),
});

export async function evaluatorNode(
  state: AgentState,
  llm: ChatOpenAI,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  lastStepRunId: string,
  lastStepOutput: string,
): Promise<Partial<AgentState>> {
  // Check cancel before evaluating
  const cancelled = await callbacks.readCancelFlag(state.runId);
  if (cancelled) {
    await callbacks.updateStepRun(lastStepRunId, {
      status: StepStatus.FAILED,
      errorMessage: '任务已取消',
    });
    return { shouldStop: true, errorMessage: 'cancelled' };
  }

  if (!state.currentPlan)
    return { evaluation: { decision: 'fail', reason: '无有效计划' } };

  const currentStep = state.currentPlan.steps[state.currentStepIndex];
  const recentSummaries = state.stepResults
    .slice(-3)
    .map((s) => s.resultSummary)
    .join('\n');

  const prompt = `评估当前步骤的执行结果，决定下一步行动。

当前步骤：${currentStep?.description ?? '未知'}
执行结果：${lastStepOutput.slice(0, 1000)}
最近几步摘要：${recentSummaries || '无'}
已重试次数：${state.retryCount}
已重规划次数：${state.replanCount}

决策选项：
- continue: 当前步骤成功，继续下一步
- retry: 步骤失败但可重试（网络超时、临时错误）
- replan: 计划不再可行，需要重新规划
- complete: 任务已完成，不需要继续
- fail: 任务无法完成（根本性错误）

注意：如果最近几步重复相同操作没有进展，返回 replan。
只返回 JSON，不要其他内容。`;

  const structured = llm.withStructuredOutput(EvalSchema);
  const result = (await structured.invoke(prompt)) as EvaluationResult;

  // Update step_run terminal status based on decision
  if (result.decision === 'retry' || result.decision === 'fail') {
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
  } else {
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

  return { evaluation: result };
}
