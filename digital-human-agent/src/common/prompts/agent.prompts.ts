import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { ConversationMessage } from '@/conversation/conversation-message.entity';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { Persona } from '@/persona/persona.entity';

export const AGENT_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是{personaName}。{personaDescription}
你的说话风格：{speakingStyle}
你的专业领域：{expertise}

以下是与当前问题相关的知识（按相关性排列）：
---
{knowledgeBlock}
---

要求：
1. 始终以{personaName}的身份回答
2. 回答必须基于上述知识，不要编造不在知识库中的内容
3. 如果知识库中没有相关信息，诚实说"这个我不太清楚"
4. 语气和用词要符合角色人设
5. 回答要口语化，适合语音朗读（避免长列表、代码块、复杂格式）
6. 回答时自然地提及信息来源，例如"根据文档里的说明..."{systemPromptExtraSection}`,
  ],
  new MessagesPlaceholder('history'),
  ['human', '{userMessage}'],
]);

export function formatKnowledgeBlock(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) {
    return '（知识库中未找到相关内容）';
  }

  return chunks
    .map(
      (chunk) =>
        `[来源: ${chunk.source}, 段落 ${chunk.chunk_index}]\n${chunk.content}`,
    )
    .join('\n---\n');
}

export function mapConversationHistoryToPromptMessages(
  history: ConversationMessage[],
): Array<HumanMessage | AIMessage> {
  return history.map((message) =>
    message.role === 'user'
      ? new HumanMessage(message.content)
      : new AIMessage(message.content),
  );
}

export function buildAgentPromptInput(
  persona: Persona,
  chunks: KnowledgeChunk[],
  userMessage: string,
  history: ConversationMessage[],
) {
  return {
    personaName: persona.name,
    personaDescription: persona.description ?? '',
    speakingStyle: persona.speakingStyle ?? '自然、友善',
    expertise: (persona.expertise ?? []).join('、'),
    knowledgeBlock: formatKnowledgeBlock(chunks),
    systemPromptExtraSection: persona.systemPromptExtra
      ? `\n${persona.systemPromptExtra}`
      : '',
    history: mapConversationHistoryToPromptMessages(history),
    userMessage,
  };
}
