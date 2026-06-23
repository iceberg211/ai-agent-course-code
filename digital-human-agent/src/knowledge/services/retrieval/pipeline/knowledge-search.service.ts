import { Injectable, Logger } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { normalizeRetrievalStrategy, type RetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import {
  DEFAULT_QUERY_REWRITE_MAX_EXPANSIONS,
} from '@/common/constants';
import { extractFallbackKeywordTerms } from '@/knowledge/services/retrieval/channels/fulltext-retriever.service';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import type {
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  NormalizedRetrieveKnowledgeOptions,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
  RetrievalQueryItem,
  KnowledgeHybridRetrievalResult,
} from '@/knowledge/types/knowledge-content.types';
import { QueryRewriteService, normalizeKeywords } from '@/knowledge/services/retrieval/processing/query-rewrite.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';

// ==========================================
// 辅助函数（原 knowledge-search.utils.ts 内容）
// ==========================================

interface ResolvedSearchInput {
  query: string;
  options: NormalizedRetrieveKnowledgeOptions;
  strategy: RetrievalStrategy;
  skipQueryRewrite: boolean;
}

function resolveSearchInput(
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

function buildEmptyResult(
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
      ? [{ index: 0, query, keywords: fallbackKeywords, angle: 'original' as const }]
      : [],
    rewrite: fallbackRewrite,
    options,
    retrievalTrace: [],
    hybridChunks: [],
    rerankedChunks: [],
  };
}

// ==========================================
// 内部接口类型
// ==========================================

interface HybridLoaderParams {
  strategy: RetrievalStrategy;
  retrievalQueries: RetrievalQueryItem[];
  options: NormalizedRetrieveKnowledgeOptions;
  signal?: AbortSignal;
}

interface HybridLoadResult {
  knowledgeCount: number;
  hybridResult: KnowledgeHybridRetrievalResult;
  emptyReason?: string;
}

// ==========================================
// KnowledgeSearchService
// ==========================================

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: RagRuntimeService,
    private readonly hybridRetrieverService: HybridRetrieverService,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
  ) {}

  async retrieve(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    try {
      const result = await this.retrieveWithStages(knowledgeId, query, options);
      return result.rerankedChunks;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `知识检索失败（knowledge=${knowledgeId}），降级为空知识：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  async retrieveWithStages(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return runInTracedScope(
      {
        name: 'knowledge_retrieve_with_stages',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'single-kb'],
        metadata: { knowledgeId },
        input: {
          knowledgeId,
          query,
          rerank: options.rerank,
          retrievalLimit: options.retrievalLimit ?? options.stage1TopK,
          rerankLimit: options.rerankLimit ?? options.finalTopK,
          threshold: options.threshold,
          skipQueryRewrite: options.skipQueryRewrite,
        },
        outputProcessor: (output) => ({
          query: output.query,
          retrievalQuery: output.retrievalQuery,
          hybridCount: output.hybridChunks.length,
          rerankedCount: output.rerankedChunks.length,
          retrievalTraceCount: output.retrievalTrace.length,
        }),
      },
      () =>
        this.retrieveWithSharedPipeline(query, options, async (params) => ({
          knowledgeCount: 1,
          hybridResult: await this.hybridRetrieverService.retrieveForKnowledge({
            knowledgeId,
            retrievalQueries: params.retrievalQueries,
            strategy: params.strategy,
            threshold: params.options.threshold,
            globalRetrievalLimit: params.options.retrievalLimit,
            signal: params.signal,
          }),
        })),
    );
  }

  async retrieveForPersona(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    return runInTracedScope(
      {
        name: 'persona_knowledge_retrieve',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'persona'],
        metadata: { personaId },
        input: {
          personaId,
          query,
          rerank: options.rerank,
          retrievalLimit: options.retrievalLimit ?? options.stage1TopK,
          rerankLimit: options.rerankLimit ?? options.finalTopK,
          threshold: options.threshold,
        },
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
      },
      async () =>
        (
          await this.retrieveForPersonaWithStagesInternal(personaId, query, options)
        ).rerankedChunks,
    );
  }

  async retrieveForPersonaWithStages(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return runInTracedScope(
      {
        name: 'persona_knowledge_retrieve_with_stages',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'persona', 'debug'],
        metadata: { personaId },
        input: {
          personaId,
          query,
          rerank: options.rerank,
          retrievalLimit: options.retrievalLimit ?? options.stage1TopK,
          rerankLimit: options.rerankLimit ?? options.finalTopK,
          threshold: options.threshold,
          strategy: options.strategy ? JSON.stringify(options.strategy) : undefined,
          skipQueryRewrite: options.skipQueryRewrite,
        },
        outputProcessor: (output) => ({
          hybridCount: output.hybridChunks.length,
          rerankedCount: output.rerankedChunks.length,
          retrievalTraceCount: output.retrievalTrace.length,
        }),
      },
      () => this.retrieveForPersonaWithStagesInternal(personaId, query, options),
    );
  }

  private async retrieveForPersonaWithStagesInternal(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return this.retrieveWithSharedPipeline(query, options, async (params) => {
      const hybridResult = await this.hybridRetrieverService.retrieveForPersona({
        personaId,
        retrievalQueries: params.retrievalQueries,
        strategy: params.strategy,
        retrievalLimit: params.options.retrievalLimit,
        threshold: params.options.threshold,
        channels: {
          useVector: params.strategy.useVector,
          useKeyword: params.strategy.useKeyword,
          useGraph: params.strategy.useGraph,
          useExactPhrase: params.strategy.useExactPhrase,
        },
        signal: params.signal,
      });

      return {
        knowledgeCount: hybridResult.knowledgeCount,
        emptyReason: `persona ${personaId} 未挂载知识库`,
        hybridResult: {
          chunks: hybridResult.chunks,
          trace: hybridResult.trace,
        },
      };
    });
  }

  private async retrieveWithSharedPipeline(
    query: string,
    options: RetrieveKnowledgeOptions,
    hybridLoader: (params: HybridLoaderParams) => Promise<HybridLoadResult>,
  ): Promise<RetrieveKnowledgeDebugResult> {
    const searchInput = resolveSearchInput(query, options, (opts) =>
      this.runtime.normalizeRetrieveOptions(opts),
    );
    throwIfAborted(options.signal);

    if (!searchInput.query) {
      return buildEmptyResult(searchInput.query, '原始问题为空，跳过检索', searchInput.options);
    }

    if (!searchInput.strategy.needRetrieval) {
      return buildEmptyResult(searchInput.query, searchInput.strategy.reason, searchInput.options);
    }

    const rewrite = await this.resolveRetrievalQuery(
      searchInput.query,
      searchInput.skipQueryRewrite,
      options.signal,
    );
    throwIfAborted(options.signal);

    const retrievalQueries = this.resolveRetrievalQueries(rewrite, searchInput.strategy);
    const loadResult = await hybridLoader({
      strategy: searchInput.strategy,
      retrievalQueries,
      options: searchInput.options,
      signal: options.signal,
    });
    throwIfAborted(options.signal);

    if (loadResult.knowledgeCount === 0) {
      return buildEmptyResult(
        searchInput.query,
        loadResult.emptyReason ?? '未找到可用知识库',
        searchInput.options,
      );
    }

    const hybridChunks = loadResult.hybridResult.chunks;
    const rerankedChunks = await this.selectRerankedChunks(
      searchInput.query,
      hybridChunks,
      searchInput.options,
      options.signal,
    );

    return {
      query: searchInput.query,
      retrievalQuery: rewrite.rewrittenQuery,
      retrievalQueries,
      rewrite,
      options: searchInput.options,
      retrievalTrace: loadResult.hybridResult.trace,
      hybridChunks,
      rerankedChunks,
    };
  }

  private async selectRerankedChunks(
    query: string,
    hybridChunks: KnowledgeChunk[],
    options: NormalizedRetrieveKnowledgeOptions,
    signal?: AbortSignal,
  ): Promise<KnowledgeChunk[]> {
    const fallbackRerankedChunks = hybridChunks.slice(0, options.rerankLimit);
    if (!options.rerank || hybridChunks.length <= 1) {
      return fallbackRerankedChunks;
    }

    try {
      return await this.rerankerService.rerank(query, hybridChunks, options.rerankLimit, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallbackRerankedChunks;
    }
  }

  private async resolveRetrievalQuery(
    query: string,
    skipQueryRewrite: boolean,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    if (skipQueryRewrite) {
      return this.queryRewriteService.buildFallbackRewrite(query, '显式跳过 Query Rewrite');
    }
    return this.queryRewriteService.rewrite(query, signal);
  }

  private resolveRetrievalQueries(
    rewrite: KnowledgeQueryRewriteResult,
    strategy: RetrievalStrategy,
  ): RetrievalQueryItem[] {
    return this.queryRewriteService.resolveRetrievalQueries(
      rewrite,
      strategy.queryCount ?? DEFAULT_QUERY_REWRITE_MAX_EXPANSIONS,
      { useMultiQuery: strategy.useMultiQuery },
    );
  }
}
