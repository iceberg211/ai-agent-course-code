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

export const RAG_ROUTE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是数字人 RAG 工作流的路由器。',
      '任务：判断当前问题更适合走 simple 还是 complex。',
      'simple：单次检索加一次生成通常就够，问题比较直接、单一、无需明显拆分步骤。',
      'complex：问题涉及多实体关系、时间先后、因果链、对比、多子问题，后续更适合接多跳或多轮检索。',
      '只做路由判断，不回答问题。',
    ].join('\n'),
  ],
  ['human', '用户问题：{question}'],
]);

export const MULTI_HOP_PLANNER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是数字人 RAG 的多跳规划器。',
      '任务：把复杂问题拆成 1 到 6 条有顺序的子问题，供后续多轮检索使用。',
      '要求：',
      '1. 每条子问题都必须是完整、可独立检索的中文问句。',
      '2. 不要使用“他/她/这个人/上述”这类指代，必要时补全实体名。',
      '3. 顺序要体现推理链，先前置事实，再后续结论。',
      '4. 不要把原问题整句机械复制多次，也不要拆成关键词碎片。',
      '5. 当前只负责规划，不负责回答。',
    ].join('\n'),
  ],
  ['human', '原始问题：{question}'],
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

export function buildRagRoutePromptInput(question: string) {
  return {
    question,
  };
}

export function buildMultiHopPlannerPromptInput(question: string) {
  return {
    question,
  };
}
