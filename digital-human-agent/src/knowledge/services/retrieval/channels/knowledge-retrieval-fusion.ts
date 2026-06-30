import { HYBRID_FUSION_RRF_K } from '@/common/constants';
import type {
  KnowledgeChunk,
  KnowledgeRetrievalSource,
  RrfTraceItem,
} from '@/knowledge/types/knowledge-content.types';

const RRF_CHANNELS: KnowledgeRetrievalSource[] = [
  'vector',
  'keyword',
  'graph',
  'memory',
  'multimodal',
];

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
  for (const channelName of RRF_CHANNELS) {
    const chunks = hybridChunks.filter((chunk) =>
      hasChannelEvidence(chunk, channelName),
    );
    if (chunks.length > 0) {
      channels.set(channelName, chunks);
    }
  }
  channels.set('graph', graphChunks);
  return fuseMultiChannelResults(channels, { globalRetrievalLimit, rrfK });
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
    memory_score: Math.max(
      current.memory_score ?? 0,
      incoming.memory_score ?? 0,
    ),
    multimodal_score: Math.max(
      current.multimodal_score ?? 0,
      incoming.multimodal_score ?? 0,
    ),
    rrf_score: Math.max(current.rrf_score ?? 0, incoming.rrf_score ?? 0),
    channel_rank: {
      ...(current.channel_rank ?? {}),
      ...(incoming.channel_rank ?? {}),
    },
    raw_score: {
      ...(current.raw_score ?? {}),
      ...(incoming.raw_score ?? {}),
    },
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
    (left.rrf_score ?? 0) - (right.rrf_score ?? 0) ||
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

export interface FuseMultiChannelResult {
  chunks: KnowledgeChunk[];
  trace: RrfTraceItem[];
}

export function fuseMultiChannelResults(
  channels: Map<string, KnowledgeChunk[]>,
  options: FuseMultiChannelOptions = {},
): KnowledgeChunk[] {
  return fuseMultiChannelResultsWithTrace(channels, options).chunks;
}

export function fuseMultiChannelResultsWithTrace(
  channels: Map<string, KnowledgeChunk[]>,
  options: FuseMultiChannelOptions = {},
): FuseMultiChannelResult {
  const rrfK = options.rrfK ?? HYBRID_FUSION_RRF_K;
  const limit = options.globalRetrievalLimit ?? 20;

  const merged = new Map<string, KnowledgeChunk>();
  const chunkRanks = new Map<string, Map<KnowledgeRetrievalSource, number>>();
  const chunkRawScores = new Map<string, Map<KnowledgeRetrievalSource, number>>();

  for (const [channelName, chunks] of channels.entries()) {
    if (!isRetrievalChannel(channelName)) continue;
    chunks.forEach((chunk, index) => {
      let ranks = chunkRanks.get(chunk.id);
      if (!ranks) {
        ranks = new Map<KnowledgeRetrievalSource, number>();
        chunkRanks.set(chunk.id, ranks);
      }
      const rank = chunk.channel_rank?.[channelName] ?? index + 1;
      ranks.set(channelName, rank);

      let rawScores = chunkRawScores.get(chunk.id);
      if (!rawScores) {
        rawScores = new Map<KnowledgeRetrievalSource, number>();
        chunkRawScores.set(chunk.id, rawScores);
      }
      rawScores.set(channelName, resolveRawScore(chunk, channelName));

      const existing = merged.get(chunk.id);
      if (existing) {
        merged.set(chunk.id, mergeRetrievedChunk(existing, chunk));
      } else {
        merged.set(chunk.id, { ...chunk });
      }
    });
  }

  const fused = Array.from(merged.values())
    .map((chunk) => {
      let totalRrfScore = 0;
      const ranks = chunkRanks.get(chunk.id);
      const sources: KnowledgeRetrievalSource[] = [];
      const channelRank: Partial<Record<KnowledgeRetrievalSource, number>> = {};
      const rawScore: Partial<Record<KnowledgeRetrievalSource, number>> = {};

      if (ranks) {
        for (const [channelName, rank] of ranks.entries()) {
          totalRrfScore += rrf(rank, rrfK);
          sources.push(channelName);
          channelRank[channelName] = rank;
          
          const raw = chunkRawScores.get(chunk.id)?.get(channelName) ?? 0;
          rawScore[channelName] = raw;
        }
      }

      return {
        ...chunk,
        hybrid_score: totalRrfScore,
        rrf_score: totalRrfScore,
        retrieval_sources: Array.from(
          new Set([...(chunk.retrieval_sources ?? []), ...sources]),
        ),
        channel_rank: channelRank,
        raw_score: rawScore,
      };
    })
    .sort((left, right) => (right.hybrid_score ?? 0) - (left.hybrid_score ?? 0))
    .slice(0, limit);

  return {
    chunks: fused,
    trace: fused.map((chunk) => ({
      chunkId: chunk.id,
      retrievalSources: chunk.retrieval_sources ?? [],
      channelRanks: chunk.channel_rank ?? {},
      rawScores: chunk.raw_score ?? {},
      rrfScore: chunk.rrf_score ?? chunk.hybrid_score ?? 0,
    })),
  };
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

function rrf(rank?: number, rrfK = HYBRID_FUSION_RRF_K): number {
  if (!rank) return 0;
  return 1 / (rrfK + rank);
}

function isRetrievalChannel(value: string): value is KnowledgeRetrievalSource {
  return RRF_CHANNELS.includes(value as KnowledgeRetrievalSource);
}

function hasChannelEvidence(
  chunk: KnowledgeChunk,
  channelName: KnowledgeRetrievalSource,
): boolean {
  return Boolean(
    chunk.retrieval_sources?.includes(channelName) ||
      chunk.channel_rank?.[channelName] !== undefined ||
      chunk.raw_score?.[channelName] !== undefined,
  );
}

function resolveRawScore(
  chunk: KnowledgeChunk,
  channelName: KnowledgeRetrievalSource,
): number {
  const existing = chunk.raw_score?.[channelName];
  if (existing !== undefined) return existing;
  switch (channelName) {
    case 'vector':
      return chunk.similarity ?? 0;
    case 'keyword':
      return chunk.keyword_score ?? 0;
    case 'graph':
      return chunk.graph_score ?? 0;
    case 'memory':
      return chunk.memory_score ?? 0;
    case 'multimodal':
      return chunk.multimodal_score ?? 0;
  }
}
