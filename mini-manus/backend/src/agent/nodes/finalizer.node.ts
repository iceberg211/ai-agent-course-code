import { ChatOpenAI } from '@langchain/openai';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { ArtifactType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { finalizerPrompt } from '@/prompts';

/** 从 LLM 输出中解析 "TYPE: xxx" 标记行，返回 [artifactType, 内容主体] */
function parseArtifactType(raw: string): [ArtifactType, string] {
  const match = raw.match(/^TYPE:\s*(markdown|code|diagram)\s*\n/i);
  if (!match) return [ArtifactType.MARKDOWN, raw];

  const typeStr = match[1].toLowerCase();
  const typeMap: Record<string, ArtifactType> = {
    code: ArtifactType.CODE,
    diagram: ArtifactType.DIAGRAM,
    markdown: ArtifactType.MARKDOWN,
  };
  const artifactType = typeMap[typeStr] ?? ArtifactType.MARKDOWN;
  const content = raw.slice(match[0].length).trimStart();
  return [artifactType, content];
}

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

  const rawContent =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  // 解析 LLM 输出中的 TYPE 标记，决定产物类型
  const [artifactType, content] = parseArtifactType(rawContent);

  const artifact = await callbacks.saveArtifact(
    state.runId,
    `任务报告: ${state.revisionInput.slice(0, 50)}`,
    content,
    artifactType,
  );

  eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, {
    taskId: state.taskId,
    runId: state.runId,
    artifactId: artifact.id,
    type: artifactType, // 动态类型，不再硬编码 'markdown'
    title: artifact.title,
  });

  return {};
}
