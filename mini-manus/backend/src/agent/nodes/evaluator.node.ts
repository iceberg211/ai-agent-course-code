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

export async function evaluatorNode(
  state: AgentState,
  llm: ChatOpenAI,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode' = 'functionCalling',
): Promise<Partial<AgentState>> {
  const lastStepRunId = state.lastStepRunId;
  const lastStepOutput = state.lastStepOutput;

  // Check cancel before evaluating
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

  if (!state.currentPlan)
    return { evaluation: { decision: 'fail', reason: '无有效计划' } };

  const currentStep = state.currentPlan.steps[state.currentStepIndex];
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

  // Every branch must close the step_run terminal state before emitting event
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
