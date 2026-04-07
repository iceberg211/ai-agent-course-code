import { ChatOpenAI } from '@langchain/openai';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';

export async function finalizerNode(
  state: AgentState,
  llm: ChatOpenAI,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
): Promise<Partial<AgentState>> {
  const context = state.stepResults
    .map(
      (s) =>
        `步骤 ${s.executionOrder + 1}: ${s.description}\n结果: ${s.resultSummary}`,
    )
    .join('\n\n');

  const response = await llm.invoke([
    {
      role: 'system',
      content:
        '你是一个专业的任务总结助手。根据执行步骤和结果，生成一份完整的任务总结报告（Markdown 格式）。',
    },
    {
      role: 'user',
      content: `任务：${state.revisionInput}\n\n执行记录：\n${context}\n\n请生成任务总结报告：`,
    },
  ]);

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
