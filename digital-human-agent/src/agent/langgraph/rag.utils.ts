import type {
  RagCitation,
  RagKnowledgeCitation,
  RagWebCitation,
  RagWorkflowInput,
} from '@/agent/types/rag-workflow.types';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import { getTurnBudget } from '@/common/rag/turn-budget.context';

export function getPlannedQuestions(
  state: Pick<RagGraphState, 'strategy' | 'subQuestions' | 'question'>,
): string[] {
  // complex 初始规划，或 simple 因 missingFacts 扩展后，都优先使用 subQuestions
  if ((state.subQuestions?.length ?? 0) > 0) {
    return state.subQuestions;
  }
  return [state.question];
}

export function getCurrentQuery(
  state: Pick<
    RagGraphState,
    | 'strategy'
    | 'subQuestions'
    | 'question'
    | 'currentHop'
    | 'retrievalHistory'
    | 'currentQuery'
  >,
): string {
  const currentQuery = state.currentQuery?.trim();
  if (currentQuery) {
    return currentQuery;
  }

  const latestQuery = state.retrievalHistory?.at(-1)?.query?.trim();
  if (latestQuery) {
    return latestQuery;
  }

  const plannedQuestions = getPlannedQuestions(state);
  const fallbackIndex = Math.min(state.currentHop, plannedQuestions.length - 1);
  return plannedQuestions[fallbackIndex]?.trim() || state.question.trim();
}

export function getNextQuery(
  state: Pick<
    RagGraphState,
    'strategy' | 'subQuestions' | 'question' | 'currentHop' | 'nextSubIdx'
  >,
): string {
  const plannedQuestions = getPlannedQuestions(state);
  const nextIndex = Number.isFinite(state.nextSubIdx)
    ? state.nextSubIdx
    : state.currentHop;
  // 越界时返回空，避免 fallback 原问题造成重复检索
  if (nextIndex < 0 || nextIndex >= plannedQuestions.length) {
    return '';
  }
  return plannedQuestions[nextIndex]?.trim() || '';
}

/** 工作流是否已超过 wall-clock 预算 */
export function isWorkflowBudgetExceeded(
  state: Pick<RagGraphState, 'workflowStartedAt' | 'workflowBudgetMs'>,
): boolean {
  const startedAt = Number(state.workflowStartedAt);
  const budgetMs = Number(state.workflowBudgetMs);
  if (!Number.isFinite(startedAt) || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    return false;
  }
  return Date.now() - startedAt >= budgetMs;
}

/**
 * 是否应停止继续 hop / web：
 * wall-clock 超时，或 TurnBudget（LLM/embed）已耗尽。
 * 注意：isExhausted 在仍可打满 generate 前一格时为 false。
 */
export function shouldStopRetrievalBudget(
  state: Pick<RagGraphState, 'workflowStartedAt' | 'workflowBudgetMs'>,
): boolean {
  if (isWorkflowBudgetExceeded(state)) {
    return true;
  }
  return getTurnBudget()?.isExhausted() === true;
}

/** 多跳候选池上限，防止 documents 膨胀拖垮 rerank */
export const RAG_MAX_CANDIDATE_DOCUMENTS = 40;

export function capCandidateDocuments<
  T extends {
    id?: string;
    similarity?: number | null;
    hybrid_score?: number | null;
    keyword_score?: number | null;
    rerank_score?: number | null;
    graph_score?: number | null;
  },
>(documents: T[], limit = RAG_MAX_CANDIDATE_DOCUMENTS): T[] {
  if (documents.length <= limit) {
    return documents;
  }
  const scoreOf = (doc: T) =>
    Math.max(
      doc.rerank_score ?? 0,
      doc.hybrid_score ?? 0,
      doc.graph_score ?? 0,
      (doc.similarity ?? 0) * 10,
      doc.keyword_score ?? 0,
    );
  return [...documents]
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, limit);
}

export function toWorkflowCitations(
  state: Pick<
    RagGraphState,
    'documents' | 'topDocuments' | 'evidenceChunks' | 'webCitations'
  >,
): RagCitation[] {
  const localChunks =
    state.topDocuments.length > 0
      ? state.topDocuments
      : state.evidenceChunks.length > 0
        ? state.evidenceChunks
        : state.documents;
  return mergeCitations(
    toKnowledgeCitations(localChunks),
    state.webCitations,
  );
}

export function canContinueMultiHop(
  state: Pick<RagGraphState, 'strategy' | 'currentHop' | 'maxHops' | 'nextSubIdx'> & {
    subQuestions: string[];
    question: string;
  },
): boolean {
  // complex 多跳规划，以及 simple 在证据不足后扩展的补检索，都允许继续本地 hop
  if (state.strategy === 'none') {
    return false;
  }

  return (
    state.nextSubIdx < state.maxHops &&
    state.nextSubIdx < getPlannedQuestions(state).length
  );
}

export function extendSubQuestionsWithMissingFacts(
  state: Pick<
    RagGraphState,
    'strategy' | 'question' | 'subQuestions' | 'retrievalHistory' | 'maxHops'
  >,
  missingFacts: string[],
): string[] {
  if (state.strategy === 'none' || missingFacts.length === 0) {
    return state.subQuestions;
  }

  const baseQuestions =
    state.subQuestions.length > 0 ? state.subQuestions : [state.question];
  const remainingSlots = Math.max(0, state.maxHops - baseQuestions.length);
  if (remainingSlots === 0) {
    return state.subQuestions.length > 0 ? state.subQuestions : baseQuestions;
  }

  const seen = new Set(
    [...baseQuestions, ...state.retrievalHistory.map((item) => item.query)]
      .map(normalizeQuestionKey)
      .filter(Boolean),
  );
  const additions: string[] = [];

  for (const fact of missingFacts) {
    const query = normalizeMissingFactQuery(fact);
    const key = normalizeQuestionKey(query);
    if (!query || seen.has(key)) continue;

    additions.push(query);
    seen.add(key);
    if (additions.length >= remainingSlots) {
      break;
    }
  }

  if (additions.length === 0) {
    return state.subQuestions;
  }

  return [...baseQuestions, ...additions];
}

export function shouldUseWebFallback(
  state: Pick<
    RagGraphState,
    | 'webSearchAttempted'
    | 'webSearchAttempts'
    | 'maxWebSearchAttempts'
    | 'webSearchQueries'
    | 'webQuery'
  >,
  webFallbackEnabled: boolean,
): boolean {
  if (!webFallbackEnabled) return false;

  const attempts = Number.isFinite(state.webSearchAttempts)
    ? state.webSearchAttempts
    : state.webSearchAttempted
      ? 1
      : 0;
  const maxAttempts = Number.isFinite(state.maxWebSearchAttempts)
    ? state.maxWebSearchAttempts
    : 1;
  if (attempts >= maxAttempts) return false;

  const queryKey = normalizeQuestionKey(state.webQuery);
  if (!queryKey) return true;

  return !(state.webSearchQueries ?? [])
    .map(normalizeQuestionKey)
    .includes(queryKey);
}

export function mergeEvidenceChunks(
  existing: RetrievedKnowledgeChunk[],
  incoming: RetrievedKnowledgeChunk[],
): RetrievedKnowledgeChunk[] {
  const merged = new Map<string, RetrievedKnowledgeChunk>();

  for (const chunk of [...existing, ...incoming]) {
    const previous = merged.get(chunk.id);
    if (!previous) {
      merged.set(chunk.id, chunk);
      continue;
    }

    merged.set(chunk.id, {
      ...previous,
      similarity: Math.max(previous.similarity ?? 0, chunk.similarity ?? 0),
      hybrid_score: Math.max(
        previous.hybrid_score ?? 0,
        chunk.hybrid_score ?? 0,
      ),
      keyword_score: Math.max(
        previous.keyword_score ?? 0,
        chunk.keyword_score ?? 0,
      ),
      rerank_score: Math.max(
        previous.rerank_score ?? 0,
        chunk.rerank_score ?? 0,
      ),
      graph_score: Math.max(previous.graph_score ?? 0, chunk.graph_score ?? 0),
      graph_evidence: mergeGraphEvidence(previous, chunk),
      retrieval_sources: Array.from(
        new Set([
          ...(previous.retrieval_sources ?? []),
          ...(chunk.retrieval_sources ?? []),
        ]),
      ),
    });
  }

  return Array.from(merged.values()).sort((left, right) =>
    compareEvidence(right, left),
  );
}

export function compareEvidence(
  left: RetrievedKnowledgeChunk,
  right: RetrievedKnowledgeChunk,
): number {
  return (
    (left.rerank_score ?? 0) - (right.rerank_score ?? 0) ||
    (left.hybrid_score ?? 0) - (right.hybrid_score ?? 0) ||
    (left.keyword_score ?? 0) - (right.keyword_score ?? 0) ||
    (left.graph_score ?? 0) - (right.graph_score ?? 0) ||
    (left.similarity ?? 0) - (right.similarity ?? 0)
  );
}

function mergeGraphEvidence(
  previous: RetrievedKnowledgeChunk,
  incoming: RetrievedKnowledgeChunk,
): RetrievedKnowledgeChunk['graph_evidence'] {
  const merged = [
    ...(previous.graph_evidence ?? []),
    ...(incoming.graph_evidence ?? []),
  ];
  if (merged.length === 0) return undefined;

  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = [
      item.source,
      item.target,
      item.relationType,
      item.evidenceText ?? '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function toKnowledgeCitations(
  chunks: RetrievedKnowledgeChunk[],
): RagKnowledgeCitation[] {
  return chunks.map((chunk) => ({
    kind: 'knowledge',
    ...chunk,
  }));
}

export function mergeCitations(
  localCitations: RagKnowledgeCitation[],
  webCitations?: RagWebCitation[],
): RagCitation[] {
  return [...localCitations, ...(webCitations ?? [])];
}

export function mergeWebCitations(
  existing?: RagWebCitation[],
  incoming?: RagWebCitation[],
): RagWebCitation[] {
  const merged = new Map<string, RagWebCitation>();

  for (const citation of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = citation.url.trim() || citation.title.trim();
    if (!key || merged.has(key)) continue;
    merged.set(key, citation);
  }

  return Array.from(merged.values());
}

export function publishCitations(
  input: RagWorkflowInput,
  citations: RagCitation[],
): void {
  if (citations.length > 0 && typeof input?.onCitations === 'function') {
    input.onCitations(citations);
  }
}

function normalizeMissingFactQuery(fact: string): string {
  const normalized = fact.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return /[。！？?]$/u.test(normalized) ? normalized : `${normalized}？`;
}

function normalizeQuestionKey(question: string): string {
  return question
    .replace(/\s+/g, '')
    .replace(/[。！？?]+$/u, '')
    .trim();
}
