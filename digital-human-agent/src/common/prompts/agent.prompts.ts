import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import { Persona } from '@/persona/persona.entity';
import type { RagEvidenceAssessmentContext } from '@/common/rag';
import { PROMPT_REGISTRY } from '@/common/prompts/prompt.registry';

const MAX_KNOWLEDGE_CHUNKS = 6;
const MAX_KNOWLEDGE_CHARS = 9_000;
const MAX_CHARS_PER_KNOWLEDGE_CHUNK = 1_800;
const MAX_WEB_CONTEXT_CHARS = 4_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;

export const AGENT_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.agentChat.system],
  new MessagesPlaceholder('history'),
  ['human', PROMPT_REGISTRY.agentChat.human],
]);

export const DIRECT_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.directChat.system],
  ['human', PROMPT_REGISTRY.directChat.human],
]);

export const RAG_ROUTE_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.ragRoute.system],
  ['human', PROMPT_REGISTRY.ragRoute.human],
]);

export const MULTI_HOP_PLANNER_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.multiHopPlanner.system],
  ['human', PROMPT_REGISTRY.multiHopPlanner.human],
]);

export const RAG_EVIDENCE_EVALUATOR_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.ragEvidenceEvaluator.system],
  ['human', PROMPT_REGISTRY.ragEvidenceEvaluator.human],
]);

export function formatKnowledgeBlock(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) {
    return '（知识库中未找到相关内容）';
  }

  let remainingChars = MAX_KNOWLEDGE_CHARS;
  const blocks: string[] = [];
  for (const chunk of chunks.slice(0, MAX_KNOWLEDGE_CHUNKS)) {
    if (remainingChars <= 0) break;
    const content = chunk.content.slice(
      0,
      Math.min(MAX_CHARS_PER_KNOWLEDGE_CHUNK, remainingChars),
    );
    const block = [
      `[来源: ${chunk.source}, 段落 ${chunk.chunk_index}]`,
      formatGraphEvidenceBlock(chunk),
      content,
    ]
      .filter(Boolean)
      .join('\n');
    blocks.push(block);
    remainingChars -= block.length;
  }
  return blocks.join('\n---\n');
}

function formatGraphEvidenceBlock(chunk: KnowledgeChunk): string {
  const graphEvidence = chunk.graph_evidence ?? [];
  if (graphEvidence.length === 0) {
    return '';
  }

  const lines = graphEvidence.slice(0, 5).map((item) => {
    const relationLabel = normalizeGraphEvidenceText(
      item.relationLabel ?? item.relationType,
    );
    const evidenceText = normalizeGraphEvidenceText(item.evidenceText);
    const confidence =
      typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? `，置信度：${Number(item.confidence.toFixed(2))}`
        : '';
    const evidence = evidenceText ? `，证据：${evidenceText}` : '';

    return `- ${normalizeGraphEvidenceText(
      item.source,
    )} --${relationLabel}--> ${normalizeGraphEvidenceText(
      item.target,
    )}（类型：${normalizeGraphEvidenceText(
      item.relationType,
    )}${confidence}${evidence}）`;
  });

  return ['图谱证据：', ...lines].join('\n');
}

function normalizeGraphEvidenceText(value: unknown): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 160) || '未知';
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

export function formatWebKnowledgeBlock(webContextBlock?: string): string {
  const normalized = String(webContextBlock ?? '')
    .trim()
    .slice(0, MAX_WEB_CONTEXT_CHARS);
  if (!normalized) {
    return '（当前未使用联网补充）';
  }

  return [
    '以下是联网补充信息（仅在本地知识不足时提供）：',
    '---',
    normalized,
    '---',
  ].join('\n');
}

export function formatMemoryContextBlock(memoryContextBlock?: string): string {
  const normalized = String(memoryContextBlock ?? '')
    .trim()
    .slice(0, MAX_MEMORY_CONTEXT_CHARS);
  if (!normalized) {
    return [
      '<conversation_context>',
      '（当前会话暂无可用短期记忆）',
      '</conversation_context>',
      '',
      '<user_preference>',
      '（当前用户暂无可用长期记忆）',
      '</user_preference>',
    ].join('\n');
  }
  return normalized;
}

export function formatEvidenceAssessmentBlock(
  assessment?: RagEvidenceAssessmentContext,
): string {
  if (!assessment) {
    return '';
  }

  if (assessment.enough === true) {
    return [
      '',
      '证据评估：当前证据被评估为足够回答问题。',
      assessment.evaluationReason
        ? `评估理由：${assessment.evaluationReason}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const missingFacts = assessment.missingFacts
    .map((item) => item.trim())
    .filter(Boolean);

  return [
    '',
    '证据评估：当前证据不足或无法完全确认答案。',
    assessment.stopReason ? `停止原因：${assessment.stopReason}` : '',
    assessment.evaluationReason
      ? `评估理由：${assessment.evaluationReason}`
      : '',
    missingFacts.length > 0
      ? `缺失信息：${missingFacts.slice(0, 6).join('；')}`
      : '',
    '回答要求：如果缺失信息会影响结论，必须明确说明无法从当前上下文确认，不要给确定性结论。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 有滚动摘要时裁短 DB history，避免与 memoryContext 重复占 token。
 * recentTurns=2 → 最多保留最近 4 条（约 2 轮 user+assistant）。
 */
export function trimHistoryAgainstRollingSummary(
  history: ConversationMessage[],
  memoryContextBlock?: string | null,
  recentTurns = 2,
): ConversationMessage[] {
  if (!history.length) return history;
  const hasSummary = /会话摘要：\S/.test(String(memoryContextBlock ?? ''));
  if (!hasSummary) {
    return history;
  }
  const keep = Math.max(0, recentTurns) * 2;
  if (history.length <= keep) {
    return history;
  }
  return history.slice(-keep);
}

export function buildAgentPromptInput(
  persona: Persona,
  chunks: KnowledgeChunk[],
  userMessage: string,
  history: ConversationMessage[],
  options?: {
    webContextBlock?: string;
    memoryContextBlock?: string;
    evidenceAssessment?: RagEvidenceAssessmentContext;
  },
) {
  const trimmedHistory = trimHistoryAgainstRollingSummary(
    history,
    options?.memoryContextBlock,
  );
  return {
    personaName: persona.name,
    personaDescription: persona.description ?? '',
    speakingStyle: persona.speakingStyle ?? '自然、友善',
    expertise: (persona.expertise ?? []).join('、'),
    knowledgeBlock: formatKnowledgeBlock(chunks),
    webKnowledgeSection: formatWebKnowledgeBlock(options?.webContextBlock),
    memoryContextSection: formatMemoryContextBlock(options?.memoryContextBlock),
    evidenceAssessmentSection: formatEvidenceAssessmentBlock(
      options?.evidenceAssessment,
    ),
    systemPromptExtraSection: persona.systemPromptExtra
      ? `\n${persona.systemPromptExtra}`
      : '',
    history: mapConversationHistoryToPromptMessages(trimmedHistory),
    userMessage,
  };
}

export function buildDirectChatPromptInput(
  userMessage: string,
  persona?: Pick<
    Persona,
    'name' | 'description' | 'speakingStyle' | 'expertise' | 'systemPromptExtra'
  > | null,
) {
  return {
    personaName: persona?.name?.trim() || '数字人助手',
    personaDescription: persona?.description ?? '',
    speakingStyle: persona?.speakingStyle ?? '自然、友善',
    expertise: (persona?.expertise ?? []).join('、') || '通用对话',
    systemPromptExtraSection: persona?.systemPromptExtra
      ? `\n${persona.systemPromptExtra}`
      : '',
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

export function buildRagEvidenceEvaluatorPromptInput(input: {
  question: string;
  currentHop: number;
  maxHops: number;
  remainingSubQuestionCount: number;
  localEvidenceBlock: string;
  webEvidenceBlock: string;
}) {
  return input;
}
