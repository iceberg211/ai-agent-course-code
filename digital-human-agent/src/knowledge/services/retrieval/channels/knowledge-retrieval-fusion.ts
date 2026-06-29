import { HYBRID_FUSION_RRF_K } from '@/common/constants';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

export function mergeHybridResults(
  hybridResults: KnowledgeChunk[][],
  globalRetrievalLimit: number,
): KnowledgeChunk[] {
  const dedupedChunks = new Map<string, KnowledgeChunk>();

  for (const chunks of hybridResults) {
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
    .slice(0, globalRetrievalLimit);
}

export function fuseHybridAndGraphChannels(
  hybridChunks: KnowledgeChunk[],
  graphChunks: KnowledgeChunk[],
  globalRetrievalLimit: number,
  rrfK?: number,
): KnowledgeChunk[] {
  const channels = new Map<string, KnowledgeChunk[]>();
  channels.set('hybrid', hybridChunks);
  channels.set('graph', graphChunks);
  return fuseMultiChannelResults(channels, { globalRetrievalLimit, rrfK });
}

function resolveHybridFusionScore(
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

export interface FuseMultiChannelOptions {
  rrfK?: number;
  globalRetrievalLimit?: number;
}

export function fuseMultiChannelResults(
  channels: Map<string, KnowledgeChunk[]>,
  options: FuseMultiChannelOptions = {},
): KnowledgeChunk[] {
  const rrfK = options.rrfK ?? HYBRID_FUSION_RRF_K;
  const limit = options.globalRetrievalLimit ?? 20;

  const merged = new Map<string, KnowledgeChunk>();
  const chunkRanks = new Map<string, Map<string, number>>();
  const chunkRawScores = new Map<string, Map<string, number>>();

  for (const [channelName, chunks] of channels.entries()) {
    chunks.forEach((chunk, index) => {
      let ranks = chunkRanks.get(chunk.id);
      if (!ranks) {
        ranks = new Map<string, number>();
        chunkRanks.set(chunk.id, ranks);
      }
      ranks.set(channelName, index + 1);

      let rawScores = chunkRawScores.get(chunk.id);
      if (!rawScores) {
        rawScores = new Map<string, number>();
        chunkRawScores.set(chunk.id, rawScores);
      }
      let score = 0;
      if (channelName === 'vector') {
        score = chunk.similarity ?? 0;
      } else if (channelName === 'keyword') {
        score = chunk.keyword_score ?? 0;
      } else if (channelName === 'graph') {
        score = chunk.graph_score ?? 0;
      } else {
        score = chunk.hybrid_score ?? 0;
      }
      rawScores.set(channelName, score);

      const existing = merged.get(chunk.id);
      if (existing) {
        merged.set(chunk.id, mergeRetrievedChunk(existing, chunk));
      } else {
        merged.set(chunk.id, { ...chunk });
      }
    });
  }

  return Array.from(merged.values())
    .map((chunk) => {
      let totalRrfScore = 0;
      const ranks = chunkRanks.get(chunk.id);
      const sources: string[] = [];
      const channelRank: Record<string, number> = {};
      const rawScore: Record<string, number> = {};

      if (ranks) {
        for (const [channelName, rank] of ranks.entries()) {
          totalRrfScore += 1 / (rrfK + rank);
          sources.push(channelName);
          channelRank[channelName] = rank;
          
          const raw = chunkRawScores.get(chunk.id)?.get(channelName) ?? 0;
          rawScore[channelName] = raw;
        }
      }

      return {
        ...chunk,
        hybrid_score: totalRrfScore,
        retrieval_sources: Array.from(
          new Set([...(chunk.retrieval_sources ?? []), ...sources]),
        ),
        channel_rank: channelRank,
        raw_score: rawScore,
      } as any;
    })
    .sort((left, right) => (right.hybrid_score ?? 0) - (left.hybrid_score ?? 0))
    .slice(0, limit);
}

export function fuseVectorAndKeywordResults(
  vectorResults: KnowledgeChunk[],
  keywordResults: KnowledgeChunk[],
  rrfK?: number,
): KnowledgeChunk[] {
  const channels = new Map<string, KnowledgeChunk[]>();
  channels.set('vector', vectorResults);
  channels.set('keyword', keywordResults);
  return fuseMultiChannelResults(channels, { globalRetrievalLimit: 1000, rrfK });
}

function rrf(rank?: number): number {
  if (!rank) return 0;
  return 1 / (HYBRID_FUSION_RRF_K + rank);
}
