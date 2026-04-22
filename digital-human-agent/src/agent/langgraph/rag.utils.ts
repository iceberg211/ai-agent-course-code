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

export function shouldUseWebFallback(
  state: Pick<RagGraphState, 'webSearchAttempted' | 'webSearchUsed'>,
  webFallbackEnabled: boolean,
): boolean {
  return (
    !state.webSearchAttempted && !state.webSearchUsed && webFallbackEnabled
  );
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
    (left.similarity ?? 0) - (right.similarity ?? 0)
  );
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

export function publishCitations(
  input: RagWorkflowInput,
  citations: RagCitation[],
): void {
  if (citations.length > 0) {
    input.onCitations(citations);
  }
}
