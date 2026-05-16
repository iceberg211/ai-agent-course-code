import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

const STAGE_FUSION_RRF_K = 60;

export function mergeStage1Results(
  stage1Results: KnowledgeChunk[][],
  globalStage1TopK: number,
): KnowledgeChunk[] {
  const dedupedChunks = new Map<string, KnowledgeChunk>();

  for (const chunks of stage1Results) {
    for (const chunk of chunks) {
      const current = dedupedChunks.get(chunk.id);
      dedupedChunks.set(
        chunk.id,
        current ? mergeRetrievedChunk(current, chunk) : chunk,
      );
    }
  }

  return Array.from(dedupedChunks.values())
    .sort((left, right) => compareRetrievalChunks(right, left))
    .slice(0, globalStage1TopK);
}

export function fuseStage1Channels(
  hybridChunks: KnowledgeChunk[],
  graphChunks: KnowledgeChunk[],
  globalStage1TopK: number,
): KnowledgeChunk[] {
  const dedupedChunks = new Map<string, KnowledgeChunk>();
  const hybridRanks = new Map<string, number>();
  const graphRanks = new Map<string, number>();

  hybridChunks.forEach((chunk, index) => {
    hybridRanks.set(chunk.id, index + 1);
    const current = dedupedChunks.get(chunk.id);
    dedupedChunks.set(
      chunk.id,
      current ? mergeRetrievedChunk(current, chunk) : chunk,
    );
  });

  graphChunks.forEach((chunk, index) => {
    graphRanks.set(chunk.id, index + 1);
    const current = dedupedChunks.get(chunk.id);
    dedupedChunks.set(
      chunk.id,
      current ? mergeRetrievedChunk(current, chunk) : chunk,
    );
  });

  return Array.from(dedupedChunks.values())
    .map((chunk) => ({
      ...chunk,
      hybrid_score: resolveStage1FusionScore(
        chunk,
        hybridRanks.get(chunk.id),
        graphRanks.get(chunk.id),
      ),
    }))
    .sort((left, right) => compareRetrievalChunks(right, left))
    .slice(0, globalStage1TopK);
}

function resolveStage1FusionScore(
  chunk: KnowledgeChunk,
  hybridRank?: number,
  graphRank?: number,
): number {
  const existingHybridScore = chunk.hybrid_score ?? 0;
  const hybridRankScore = rrf(hybridRank);
  const graphRankScore = rrf(graphRank);
  return Math.max(existingHybridScore, hybridRankScore) + graphRankScore;
}

function mergeRetrievedChunk(
  current: KnowledgeChunk,
  incoming: KnowledgeChunk,
): KnowledgeChunk {
  const better =
    compareRetrievalChunks(incoming, current) > 0 ? incoming : current;

  return {
    ...better,
    similarity: Math.max(current.similarity ?? 0, incoming.similarity ?? 0),
    hybrid_score: Math.max(
      current.hybrid_score ?? 0,
      incoming.hybrid_score ?? 0,
    ),
    keyword_score: Math.max(
      current.keyword_score ?? 0,
      incoming.keyword_score ?? 0,
    ),
    graph_score: Math.max(current.graph_score ?? 0, incoming.graph_score ?? 0),
    retrieval_sources: Array.from(
      new Set([
        ...(current.retrieval_sources ?? []),
        ...(incoming.retrieval_sources ?? []),
      ]),
    ),
    matched_queries: Array.from(
      new Set([
        ...(current.matched_queries ?? []),
        ...(incoming.matched_queries ?? []),
      ]),
    ).sort((left, right) => left - right),
    keyword_backend: incoming.keyword_backend ?? current.keyword_backend,
    vector_backend: incoming.vector_backend ?? current.vector_backend,
    graph_evidence: mergeGraphEvidence(current, incoming),
  };
}

function compareRetrievalChunks(
  left: KnowledgeChunk,
  right: KnowledgeChunk,
): number {
  return (
    (left.hybrid_score ?? 0) - (right.hybrid_score ?? 0) ||
    (left.keyword_score ?? 0) - (right.keyword_score ?? 0) ||
    (left.graph_score ?? 0) - (right.graph_score ?? 0) ||
    (left.similarity ?? 0) - (right.similarity ?? 0)
  );
}

function mergeGraphEvidence(
  current: KnowledgeChunk,
  incoming: KnowledgeChunk,
): KnowledgeChunk['graph_evidence'] {
  const merged = [
    ...(current.graph_evidence ?? []),
    ...(incoming.graph_evidence ?? []),
  ];
  if (merged.length === 0) return undefined;

  const keys = new Set<string>();
  return merged.filter((item) => {
    const key = [
      item.source,
      item.target,
      item.relationType,
      item.evidenceText ?? '',
    ].join('|');
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function rrf(rank?: number): number {
  if (!rank) return 0;
  return 1 / (STAGE_FUSION_RRF_K + rank);
}
