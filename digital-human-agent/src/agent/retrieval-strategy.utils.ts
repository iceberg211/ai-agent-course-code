import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';

export const DEFAULT_RETRIEVAL_STRATEGY: RetrievalStrategy = {
  needRetrieval: true,
  useVector: true,
  useKeyword: true,
  useGraph: false,
  useExactPhrase: false,
  useMultiQuery: true,
  useHyDE: false,
  allowWeb: true,
  queryCount: 3,
  chunkContextWindow: 0,
  contextCompression: false,
  lostInMiddle: true,
  reason: '默认使用本地混合检索',
};

export function normalizeRetrievalStrategy(
  strategy?: Partial<RetrievalStrategy> | null,
): RetrievalStrategy {
  const merged = {
    ...DEFAULT_RETRIEVAL_STRATEGY,
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
    reason: String(merged.reason ?? '').trim() || '使用默认检索策略',
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
