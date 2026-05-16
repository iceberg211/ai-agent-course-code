import type {
  RagCitation,
  RagKnowledgeCitation,
  RagWebCitation,
  RagWorkflowInput,
} from '@/agent/types/rag-workflow.types';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export function getPlannedQuestions(
  state: Pick<RagGraphState, 'strategy' | 'subQuestions' | 'question'>,
): string[] {
  return state.strategy === 'complex' && state.subQuestions.length > 0
    ? state.subQuestions
    : [state.question];
}

export function getCurrentQuery(
  state: Pick<
    RagGraphState,
    'strategy' | 'subQuestions' | 'question' | 'currentHop' | 'retrievalHistory'
  >,
): string {
  const latestQuery = state.retrievalHistory.at(-1)?.query?.trim();
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
    'strategy' | 'subQuestions' | 'question' | 'currentHop'
  >,
): string {
  const plannedQuestions = getPlannedQuestions(state);
  return plannedQuestions[state.currentHop]?.trim() || state.question.trim();
}

export function toWorkflowCitations(
  state: Pick<RagGraphState, 'evidenceChunks' | 'webCitations'>,
): RagCitation[] {
  return mergeCitations(
    toKnowledgeCitations(state.evidenceChunks),
    state.webCitations,
  );
}

export function canContinueMultiHop(
  state: Pick<RagGraphState, 'strategy' | 'currentHop' | 'maxHops'> & {
    subQuestions: string[];
    question: string;
  },
): boolean {
  if (state.strategy !== 'complex') {
    return false;
  }

  return (
    state.currentHop < state.maxHops &&
    state.currentHop < getPlannedQuestions(state).length
  );
}

export function extendSubQuestionsWithMissingFacts(
  state: Pick<
    RagGraphState,
    'strategy' | 'question' | 'subQuestions' | 'retrievalHistory' | 'maxHops'
  >,
  missingFacts: string[],
): string[] {
  if (state.strategy !== 'complex' || missingFacts.length === 0) {
    return state.subQuestions;
  }

  const baseQuestions =
    state.subQuestions.length > 0 ? state.subQuestions : [state.question];
  const remainingSlots = Math.max(0, state.maxHops - baseQuestions.length);
  if (remainingSlots === 0) {
    return state.subQuestions;
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
  webCitations: RagWebCitation[],
): RagCitation[] {
  return [...localCitations, ...webCitations];
}

export function mergeWebCitations(
  existing: RagWebCitation[],
  incoming: RagWebCitation[],
): RagWebCitation[] {
  const merged = new Map<string, RagWebCitation>();

  for (const citation of [...existing, ...incoming]) {
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
  if (citations.length > 0) {
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
