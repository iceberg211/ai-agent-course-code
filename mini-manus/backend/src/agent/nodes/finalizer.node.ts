import { ChatOpenAI } from '@langchain/openai';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { finalizerPrompt } from '@/prompts';

export async function finalizerNode(
  state: AgentState,
  llm: ChatOpenAI,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
): Promise<Partial<AgentState>> {
  const executionContext = state.stepResults
    .map(
      (s) =>
        `步骤 ${s.executionOrder + 1}: ${s.description}\n结果: ${s.resultSummary}`,
    )
    .join('\n\n');

  const chain = finalizerPrompt.pipe(llm);
  const response = await chain.invoke({
    revisionInput: state.revisionInput,
    executionContext,
  });

  const content =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  const artifact = await callbacks.saveArtifact(
    state.runId,
    `任务报告: ${state.revisionInput.slice(0, 50)}`,
    content,
  );

  eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, {
    taskId: state.taskId,
    runId: state.runId,
    artifactId: artifact.id,
    type: 'markdown',
    title: artifact.title,
  });

  return {};
}
