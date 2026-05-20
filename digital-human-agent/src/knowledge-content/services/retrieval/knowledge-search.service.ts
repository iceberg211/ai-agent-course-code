import { Injectable, Logger } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { normalizeRetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { extractFallbackKeywordTerms } from '@/knowledge-content/services/retrieval/knowledge-keyword-retriever.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/manage/knowledge-content-runtime.service';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/retrieval/knowledge-hybrid-retriever.service';
import type {
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  NormalizedRetrieveKnowledgeOptions,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
  RetrievalQueryItem,
  KnowledgeHybridRetrievalResult,
} from '@/knowledge-content/types/knowledge-content.types';
import { QueryRewriteService } from '@/knowledge-content/services/retrieval/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/retrieval/reranker.service';
import type { RetrievalStrategy } from '@/common/rag';

interface ResolvedSearchInput {
  query: string;
  options: NormalizedRetrieveKnowledgeOptions;
  strategy: RetrievalStrategy;
  skipQueryRewrite: boolean;
}

interface Stage1LoaderParams {
  strategy: RetrievalStrategy;
  retrievalQueries: RetrievalQueryItem[];
  options: NormalizedRetrieveKnowledgeOptions;
  signal?: AbortSignal;
}

interface Stage1LoadResult {
  knowledgeCount: number;
  stage1Result: KnowledgeHybridRetrievalResult;
  emptyReason?: string;
}

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly hybridRetrieverService: KnowledgeHybridRetrieverService,
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
      return result.stage2;
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
        metadata: {
          knowledgeId,
        },
        input: {
          knowledgeId,
          query,
          rerank: options.rerank,
          stage1TopK: options.stage1TopK,
          finalTopK: options.finalTopK,
          threshold: options.threshold,
          skipQueryRewrite: options.skipQueryRewrite,
        },
        outputProcessor: (output) => ({
          query: output.query,
          retrievalQuery: output.retrievalQuery,
          stage1Count: output.stage1.length,
          stage2Count: output.stage2.length,
          stage1TraceCount: output.stage1Trace.length,
        }),
      },
      () =>
        this.retrieveWithSharedPipeline(query, options, async (params) => ({
          knowledgeCount: 1,
          stage1Result: await this.hybridRetrieverService.retrieveForKnowledge({
            knowledgeId,
            retrievalQueries: params.retrievalQueries,
            strategy: params.strategy,
            threshold: params.options.threshold,
            globalStage1TopK: params.options.stage1TopK,
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
        metadata: {
          personaId,
        },
        input: {
          personaId,
          query,
          rerank: options.rerank,
          stage1TopK: options.stage1TopK,
          finalTopK: options.finalTopK,
          threshold: options.threshold,
        },
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
      },
      async () =>
        (
          await this.retrieveForPersonaWithStagesInternal(
            personaId,
            query,
            options,
          )
        ).stage2,
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
        metadata: {
          personaId,
        },
        input: {
          personaId,
          query,
          rerank: options.rerank,
          stage1TopK: options.stage1TopK,
          finalTopK: options.finalTopK,
          threshold: options.threshold,
          strategy: options.strategy
            ? JSON.stringify(options.strategy)
            : undefined,
          skipQueryRewrite: options.skipQueryRewrite,
        },
        outputProcessor: (output) => ({
          stage1Count: output.stage1.length,
          stage2Count: output.stage2.length,
          stage1TraceCount: output.stage1Trace.length,
        }),
      },
      () =>
        this.retrieveForPersonaWithStagesInternal(personaId, query, options),
    );
  }

  private async retrieveForPersonaWithStagesInternal(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return this.retrieveWithSharedPipeline(query, options, async (params) => {
      const stage1Result = await this.hybridRetrieverService.retrieveForPersona({
        personaId,
        retrievalQueries: params.retrievalQueries,
        stage1TopK: params.options.stage1TopK,
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
        knowledgeCount: stage1Result.knowledgeCount,
        emptyReason: `persona ${personaId} 未挂载知识库`,
        stage1Result: {
          chunks: stage1Result.chunks,
          trace: stage1Result.trace,
        },
      };
    });
  }

  private async retrieveWithSharedPipeline(
    query: string,
    options: RetrieveKnowledgeOptions,
    stage1Loader: (params: Stage1LoaderParams) => Promise<Stage1LoadResult>,
  ): Promise<RetrieveKnowledgeDebugResult> {
    const searchInput = this.resolveSearchInput(query, options);
    throwIfAborted(options.signal);

    if (!searchInput.query) {
      return this.buildEmptyResult(
        searchInput.query,
        '原始问题为空，跳过检索',
        searchInput.options,
      );
    }

    if (!searchInput.strategy.needRetrieval) {
      return this.buildEmptyResult(
        searchInput.query,
        searchInput.strategy.reason,
        searchInput.options,
      );
    }

    const rewrite = await this.resolveRetrievalQuery(
      searchInput.query,
      searchInput.skipQueryRewrite,
      options.signal,
    );
    throwIfAborted(options.signal);

    const retrievalQueries = this.resolveRetrievalQueries(
      rewrite,
      searchInput.strategy,
    );
    const loadResult = await stage1Loader({
      strategy: searchInput.strategy,
      retrievalQueries,
      options: searchInput.options,
      signal: options.signal,
    });
    throwIfAborted(options.signal);

    if (loadResult.knowledgeCount === 0) {
      return this.buildEmptyResult(
        searchInput.query,
        loadResult.emptyReason ?? '未找到可用知识库',
        searchInput.options,
      );
    }

    const stage1 = loadResult.stage1Result.chunks;
    const stage2 = await this.selectStage2(
      searchInput.query,
      stage1,
      searchInput.options,
      options.signal,
    );

    return {
      query: searchInput.query,
      retrievalQuery: rewrite.rewrittenQuery,
      retrievalQueries,
      rewrite,
      options: searchInput.options,
      stage1Trace: loadResult.stage1Result.trace,
      stage1,
      stage2,
    };
  }

  private resolveSearchInput(
    query: string,
    options: RetrieveKnowledgeOptions,
  ): ResolvedSearchInput {
    const normalizedQuery = query.trim();
    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);
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

  private async selectStage2(
    query: string,
    stage1: KnowledgeChunk[],
    options: NormalizedRetrieveKnowledgeOptions,
    signal?: AbortSignal,
  ): Promise<KnowledgeChunk[]> {
    const fallbackStage2 = stage1.slice(0, options.finalTopK);
    if (!options.rerank || stage1.length <= 1) {
      return fallbackStage2;
    }

    try {
      return await this.rerankerService.rerank(
        query,
        stage1,
        options.finalTopK,
        signal,
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallbackStage2;
    }
  }

  private async resolveRetrievalQuery(
    query: string,
    skipQueryRewrite: boolean,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    if (skipQueryRewrite) {
      return this.buildFallbackRewrite(query, '显式跳过 Query Rewrite');
    }
    return this.queryRewriteService.rewrite(query, signal);
  }

  private resolveRetrievalQueries(
    rewrite: KnowledgeQueryRewriteResult,
    strategy: RetrievalStrategy,
  ): RetrievalQueryItem[] {
    const queries =
      strategy.useMultiQuery && (rewrite.expandedQueries?.length ?? 0) > 0
        ? rewrite.expandedQueries
        : [
            {
              index: 0,
              query: rewrite.rewrittenQuery,
              keywords: rewrite.keywords,
              angle:
                rewrite.rewrittenQuery === rewrite.originalQuery
                  ? ('original' as const)
                  : ('semantic' as const),
            },
          ];

    return queries.slice(0, strategy.queryCount ?? 3).map((item, index) => ({
      ...item,
      index,
    }));
  }

  private buildEmptyResult(
    query: string,
    reason: string,
    options: NormalizedRetrieveKnowledgeOptions,
  ): RetrieveKnowledgeDebugResult {
    const fallbackRewrite = this.buildFallbackRewrite(query, reason);
    return {
      query,
      retrievalQuery: query,
      retrievalQueries: query ? fallbackRewrite.expandedQueries : [],
      rewrite: fallbackRewrite,
      options,
      stage1Trace: [],
      stage1: [],
      stage2: [],
    };
  }

  private buildFallbackRewrite(
    query: string,
    reason: string,
  ): KnowledgeQueryRewriteResult {
    const keywords = extractFallbackKeywordTerms(query).slice(0, 6);
    return {
      originalQuery: query,
      rewrittenQuery: query,
      keywords,
      expandedQueries: query
        ? [
            {
              index: 0,
              query,
              keywords,
              angle: 'original',
            },
          ]
        : [],
      changed: false,
      reason,
    };
  }
}
