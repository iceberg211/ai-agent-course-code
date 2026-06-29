import type { RetrievalStrategy, RetrievalPreset } from '@/common/rag/retrieval-strategy.types';

export const DEFAULT_RETRIEVAL_STRATEGY: RetrievalStrategy = {
  name: 'balanced',
  needRetrieval: true,
  useVector: true,
  useKeyword: true,
  useGraph: false,
  useExactPhrase: false,
  useMultiQuery: true,
  allowWeb: true,
  queryCount: 3,
  chunkContextWindow: 0,
  reason: '默认使用平衡混合检索',
  useMemory: false,
  useMultimodal: false,
  vectorTopK: 10,
  keywordTopK: 10,
  graphTopK: 5,
  memoryTopK: 3,
  rrfK: 60,
  rerankTopK: 5,
  minRerankScore: 3.0,
};

export function createRetrievalStrategyPreset(
  preset: RetrievalPreset,
  overrides?: Partial<RetrievalStrategy>,
): RetrievalStrategy {
  const base = { ...DEFAULT_RETRIEVAL_STRATEGY, name: preset };
  switch (preset) {
    case 'precise':
      return {
        ...base,
        reason: '精准检索策略',
        vectorTopK: 15,
        keywordTopK: 5,
        rrfK: 50,
        rerankTopK: 3,
        minRerankScore: 4.0,
        ...overrides,
      };
    case 'balanced':
      return {
        ...base,
        reason: '平衡混合检索策略',
        vectorTopK: 10,
        keywordTopK: 10,
        rrfK: 60,
        rerankTopK: 5,
        minRerankScore: 3.0,
        ...overrides,
      };
    case 'broad':
      return {
        ...base,
        reason: '广度混合检索策略',
        vectorTopK: 15,
        keywordTopK: 15,
        rrfK: 80,
        rerankTopK: 8,
        minRerankScore: 1.5,
        ...overrides,
      };
    case 'graph_first':
      return {
        ...base,
        reason: '图谱优先检索策略',
        useGraph: true,
        graphTopK: 15,
        vectorTopK: 5,
        keywordTopK: 5,
        rrfK: 60,
        rerankTopK: 5,
        minRerankScore: 2.0,
        ...overrides,
      };
    case 'memory_aware':
      return {
        ...base,
        reason: '记忆感知检索策略',
        useMemory: true,
        memoryTopK: 5,
        ...overrides,
      };
    case 'multimodal':
      return {
        ...base,
        reason: '多模态检索策略',
        useMultimodal: true,
        vectorTopK: 10,
        keywordTopK: 10,
        ...overrides,
      };
  }
}

export function normalizeRetrievalStrategy(
  strategy?: Partial<RetrievalStrategy> | null,
): RetrievalStrategy {
  const presetName = strategy?.name || 'balanced';
  const basePreset = createRetrievalStrategyPreset(presetName as RetrievalPreset);
  const merged = {
    ...basePreset,
    ...(strategy ?? {}),
  };
  const useGraph = isGraphRetrievalEnabled() && merged.useGraph === true;

  const needRetrieval =
    merged.needRetrieval !== false &&
    (merged.useVector || merged.useKeyword || useGraph);

  return {
    ...merged,
    useGraph,
    needRetrieval,
    queryCount: clampInteger(merged.queryCount, 1, 5, 3),
    chunkContextWindow: clampInteger(merged.chunkContextWindow, 0, 2, 0),
    graphMaxHops:
      merged.graphMaxHops === undefined
        ? undefined
        : clampInteger(merged.graphMaxHops, 1, 3, 2),
    reason: String(merged.reason ?? '').trim() || '使用检索策略',
  };
}

function isGraphRetrievalEnabled(): boolean {
  return String(process.env.NEO4J_GRAPH_ENABLED ?? '').trim() === 'true';
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
