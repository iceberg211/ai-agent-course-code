import {
  normalizeRetrievalStrategy,
} from './retrieval-utils';
import {
  normalizeKeywords,
  resolveRetrievalQueries,
} from './query-rewrite-utils';
import type {
  RetrieveKnowledgeOptions,
  NormalizedRetrieveKnowledgeOptions,
  RetrievalStrategy,
  RetrieveKnowledgeDebugResult,
} from '@/knowledge/types/knowledge-content.types';

export interface ResolvedSearchInput {
  query: string;
  options: NormalizedRetrieveKnowledgeOptions;
  strategy: RetrievalStrategy;
  skipQueryRewrite: boolean;
}

export function resolveSearchInput(
  query: string,
  options: RetrieveKnowledgeOptions,
  normalizeRetrieveOptions: (opts: RetrieveKnowledgeOptions) => NormalizedRetrieveKnowledgeOptions,
): ResolvedSearchInput {
  const normalizedQuery = query.trim();
  const normalizedOptions = normalizeRetrieveOptions(options);
  const strategy = normalizeRetrievalStrategy(options.strategy);
  const skipQueryRewrite =
    normalizedOptions.skipQueryRewrite || !strategy.useMultiQuery;

  normalizedOptions.strategy = strategy;
  normalizedOptions.skipQueryRewrite = skipQueryRewrite;

  return {
    query: normalizedQuery,
    options: normalizedOptions,
    strategy,
    skipQueryRewrite,
  };
}

export function buildEmptyResult(
  query: string,
  reason: string,
  options: NormalizedRetrieveKnowledgeOptions,
): RetrieveKnowledgeDebugResult {
  const fallbackKeywords = normalizeKeywords([], query);
  const fallbackRewrite = {
    originalQuery: query,
    rewrittenQuery: query,
    keywords: fallbackKeywords,
    expandedQueries: query
      ? [
          {
            index: 0,
            query,
            keywords: fallbackKeywords,
            angle: 'original' as const,
          },
        ]
      : [],
    changed: false,
    reason,
  };
  return {
    query,
    retrievalQuery: query,
    retrievalQueries: query
      ? resolveRetrievalQueries(fallbackRewrite, 1, {
          useMultiQuery: false,
          preferOriginal: false,
        })
      : [],
    rewrite: fallbackRewrite,
    options,
    retrievalTrace: [],
    hybridChunks: [],
    rerankedChunks: [],
  };
}
