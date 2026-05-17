import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { ConversationMessage } from '@/conversation/conversation-message.entity';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { Persona } from '@/persona/persona.entity';
import type { RagEvidenceAssessmentContext } from '@/agent/types/rag-workflow.types';
import { PROMPT_REGISTRY } from '@/common/prompts/prompt.registry';

export const AGENT_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.agentChat.system],
  new MessagesPlaceholder('history'),
  ['human', PROMPT_REGISTRY.agentChat.human],
]);

export const RAG_ROUTE_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.ragRoute.system],
  ['human', PROMPT_REGISTRY.ragRoute.human],
]);

export const RAG_RETRIEVAL_STRATEGY_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.ragRetrievalStrategy.system],
  ['human', PROMPT_REGISTRY.ragRetrievalStrategy.human],
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

  return chunks
    .map((chunk) => {
      const graphEvidenceBlock = formatGraphEvidenceBlock(chunk);
      return [
        `[来源: ${chunk.source}, 段落 ${chunk.chunk_index}]`,
        graphEvidenceBlock,
        chunk.content,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n---\n');
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
  const normalized = String(webContextBlock ?? '').trim();
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

export function buildAgentPromptInput(
  persona: Persona,
  chunks: KnowledgeChunk[],
  userMessage: string,
  history: ConversationMessage[],
  options?: {
    webContextBlock?: string;
    evidenceAssessment?: RagEvidenceAssessmentContext;
  },
) {
  return {
    personaName: persona.name,
    personaDescription: persona.description ?? '',
    speakingStyle: persona.speakingStyle ?? '自然、友善',
    expertise: (persona.expertise ?? []).join('、'),
    knowledgeBlock: formatKnowledgeBlock(chunks),
    webKnowledgeSection: formatWebKnowledgeBlock(options?.webContextBlock),
    evidenceAssessmentSection: formatEvidenceAssessmentBlock(
      options?.evidenceAssessment,
    ),
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

export function buildRagRetrievalStrategyPromptInput(input: {
  question: string;
  currentQuery: string;
  routeStrategy: string;
  remainingHops: number;
}) {
  return input;
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
