import { Injectable, Logger } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import { normalizeRetrievalStrategy } from '@/agent/retrieval-strategy.utils';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type {
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  RetrieveKnowledgeTraceItem,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';
import type { HybridRetrieveResult } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly hybridRetriever: KnowledgeHybridRetrieverService,
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
      if (this.isAbortError(error)) {
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
        },
        outputProcessor: (output) => ({
          query: output.query,
          retrievalQuery: output.retrievalQuery,
          stage1Count: output.stage1.length,
          stage2Count: output.stage2.length,
          stage1TraceCount: output.stage1Trace.length,
        }),
      },
      () => this.retrieveWithStagesInternal(knowledgeId, query, options),
    );
  }

  private async retrieveWithStagesInternal(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    const normalizedQuery = query.trim();
    throwIfAborted(options.signal);

    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);
    const strategy = normalizeRetrievalStrategy(options.strategy);
    normalizedOptions.strategy = strategy;

    if (!normalizedQuery) {
      const fallbackRewrite = this.buildFallbackRewrite(
        normalizedQuery,
        '原始问题为空，跳过改写',
      );
      return {
        query: normalizedQuery,
        retrievalQuery: normalizedQuery,
        rewrite: fallbackRewrite,
        options: normalizedOptions,
        retrievalQueries: [],
        stage1Trace: [],
        stage1: [],
        stage2: [],
      };
    }

    if (!strategy.needRetrieval) {
      const fallbackRewrite = this.buildFallbackRewrite(
        normalizedQuery,
        strategy.reason,
      );
      return {
        query: normalizedQuery,
        retrievalQuery: normalizedQuery,
        retrievalQueries: fallbackRewrite.expandedQueries,
        rewrite: fallbackRewrite,
        options: normalizedOptions,
        stage1Trace: [],
        stage1: [],
        stage2: [],
      };
    }

    const rewrite = await this.resolveRetrievalQuery(
      normalizedQuery,
      options.signal,
    );
    throwIfAborted(options.signal);

    const retrievalQueries = this.resolveRetrievalQueries(rewrite, strategy);
    const hydeQueryEmbedding = await this.resolveHydeEmbedding(
      normalizedQuery,
      strategy,
      options.signal,
    );
    const stage1Result = await this.retrieveStage1ForKnowledge(
      knowledgeId,
      retrievalQueries,
      hydeQueryEmbedding,
      strategy,
      normalizedOptions.threshold,
      normalizedOptions.stage1TopK,
      options.signal,
    );
    throwIfAborted(options.signal);

    const stage1 = stage1Result.chunks;

    let stage2 = stage1.slice(0, normalizedOptions.finalTopK);
    if (normalizedOptions.rerank && stage1.length > 1) {
      try {
        stage2 = await this.rerankerService.rerank(
          normalizedQuery,
          stage1,
          normalizedOptions.finalTopK,
          options.signal,
        );
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }

        this.logger.warn(
          `Reranker 失败，回退为向量检索结果：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      query: normalizedQuery,
      retrievalQuery: rewrite.rewrittenQuery,
      retrievalQueries,
      rewrite,
      options: normalizedOptions,
      stage1Trace: stage1Result.trace,
      stage1,
      stage2,
    };
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
        (await this.retrieveForPersonaWithStagesInternal(personaId, query, options))
          .stage2,
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
          strategy: options.strategy ? JSON.stringify(options.strategy) : undefined,
        },
        outputProcessor: (output) => ({
          stage1Count: output.stage1.length,
          stage2Count: output.stage2.length,
          stage1TraceCount: output.stage1Trace.length,
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
    const normalizedQuery = query.trim();
    throwIfAborted(options.signal);

    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);
    const strategy = normalizeRetrievalStrategy(options.strategy);
    normalizedOptions.strategy = strategy;

    if (!normalizedQuery) {
      const fallbackRewrite = this.buildFallbackRewrite(
        normalizedQuery,
        '原始问题为空，跳过检索',
      );
      return {
        query: normalizedQuery,
        retrievalQuery: normalizedQuery,
        retrievalQueries: [],
        rewrite: fallbackRewrite,
        options: normalizedOptions,
        stage1Trace: [],
        stage1: [],
        stage2: [],
      };
    }

    if (!strategy.needRetrieval) {
      const fallbackRewrite = this.buildFallbackRewrite(
        normalizedQuery,
        strategy.reason,
      );
      return {
        query: normalizedQuery,
        retrievalQuery: normalizedQuery,
        retrievalQueries: fallbackRewrite.expandedQueries,
        rewrite: fallbackRewrite,
        options: normalizedOptions,
        stage1Trace: [],
        stage1: [],
        stage2: [],
      };
    }

    const knowledgeConfigs = await this.listMountedKnowledgeConfigs(personaId);
    throwIfAborted(options.signal);

    if (knowledgeConfigs.length === 0) {
      const fallbackRewrite = this.buildFallbackRewrite(
        normalizedQuery,
        `persona ${personaId} 未挂载知识库`,
      );
      return {
        query: normalizedQuery,
        retrievalQuery: normalizedQuery,
        retrievalQueries: fallbackRewrite.expandedQueries,
        rewrite: fallbackRewrite,
        options: normalizedOptions,
        stage1Trace: [],
        stage1: [],
        stage2: [],
      };
    }

    const rewrite = await this.resolveRetrievalQuery(
      normalizedQuery,
      options.signal,
    );
    throwIfAborted(options.signal);

    const retrievalQueries = this.resolveRetrievalQueries(rewrite, strategy);
    const hydeQueryEmbedding = await this.resolveHydeEmbedding(
      normalizedQuery,
      strategy,
      options.signal,
    );
    throwIfAborted(options.signal);

    const stage1Results = await Promise.all(
      knowledgeConfigs.map(async (config) => {
        try {
          throwIfAborted(options.signal);

          const effectiveThreshold =
            options.threshold === undefined
              ? config.threshold
              : normalizedOptions.threshold;
          const effectiveStage1TopK =
            options.stage1TopK === undefined
              ? config.stage1TopK
              : normalizedOptions.stage1TopK;
          const stage1Result = await this.retrieveStage1ForKnowledge(
            config.knowledgeId,
            retrievalQueries,
            hydeQueryEmbedding,
            strategy,
            effectiveThreshold,
            effectiveStage1TopK,
            options.signal,
          );
          throwIfAborted(options.signal);

          return stage1Result;
        } catch (error) {
          if (this.isAbortError(error)) {
            throw error;
          }

          this.logger.warn(
            `stage1 失败（knowledge=${config.knowledgeId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            chunks: [] as KnowledgeChunk[],
            trace: [] as RetrieveKnowledgeTraceItem[],
          };
        }
      }),
    );

    const mergedStage1 = this.mergeStage1Results(
      stage1Results.map((result) => result.chunks),
      options.stage1TopK === undefined
        ? Math.max(20, ...knowledgeConfigs.map((config) => config.stage1TopK))
        : normalizedOptions.stage1TopK,
    );
    const stage1Trace = stage1Results.flatMap((result) => result.trace);
    if (mergedStage1.length <= 1 || !normalizedOptions.rerank) {
      return {
        query: normalizedQuery,
        retrievalQuery: rewrite.rewrittenQuery,
        retrievalQueries,
        rewrite,
        options: normalizedOptions,
        stage1Trace,
        stage1: mergedStage1,
        stage2: mergedStage1.slice(0, normalizedOptions.finalTopK),
      };
    }

    try {
      const stage2 = await this.rerankerService.rerank(
        normalizedQuery,
        mergedStage1,
        normalizedOptions.finalTopK,
        options.signal,
      );
      return {
        query: normalizedQuery,
        retrievalQuery: rewrite.rewrittenQuery,
        retrievalQueries,
        rewrite,
        options: normalizedOptions,
        stage1Trace,
        stage1: mergedStage1,
        stage2,
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        query: normalizedQuery,
        retrievalQuery: rewrite.rewrittenQuery,
        retrievalQueries,
        rewrite,
        options: normalizedOptions,
        stage1Trace,
        stage1: mergedStage1,
        stage2: mergedStage1.slice(0, normalizedOptions.finalTopK),
      };
    }
  }

  private async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<
    Array<{ knowledgeId: string; threshold: number; stage1TopK: number }>
  > {
    const { data: mounts, error: mountError } = await this.runtime.supabase
      .from('persona_knowledge_base')
      .select('knowledge_base_id')
      .eq('persona_id', personaId);

    if (mountError) {
      this.logger.warn(
        `查询 persona ${personaId} 挂载失败：${mountError.message}`,
      );
      return [];
    }

    if (!mounts || mounts.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
    }

    const knowledgeIds = mounts.map((item) => item.knowledge_base_id as string);
    const { data: knowledgeRows, error: knowledgeError } =
      await this.runtime.supabase
        .from('knowledge_base')
        .select('id, retrieval_config')
        .in('id', knowledgeIds);

    if (knowledgeError || !knowledgeRows || knowledgeRows.length === 0) {
      if (knowledgeError) {
        this.logger.warn(`查询知识库配置失败：${knowledgeError.message}`);
      }
      return [];
    }

    return knowledgeRows.map((knowledge) => {
      const config =
        (knowledge.retrieval_config as Partial<KnowledgeRetrievalConfig>) ?? {};

      return {
        knowledgeId: knowledge.id as string,
        threshold: this.runtime.toBoundedNumber(config.threshold, 0.6, 0, 1),
        stage1TopK: this.runtime.toBoundedNumber(config.stage1TopK, 20, 1, 50),
      };
    });
  }

  private mergeStage1Results(
    stage1Results: KnowledgeChunk[][],
    globalStage1TopK: number,
  ): KnowledgeChunk[] {
    const dedupedChunks = new Map<string, KnowledgeChunk>();

    for (const chunks of stage1Results) {
      for (const chunk of chunks) {
        const current = dedupedChunks.get(chunk.id);
        dedupedChunks.set(
          chunk.id,
          current ? this.mergeRetrievedChunk(current, chunk) : chunk,
        );
      }
    }

    const sortedChunks = Array.from(dedupedChunks.values()).sort(
      (left, right) => this.compareRetrievalChunks(right, left),
    );

    return sortedChunks.slice(0, globalStage1TopK);
  }

  private async resolveRetrievalQuery(
    query: string,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    return this.queryRewriteService.rewrite(query, signal);
  }

  private buildFallbackRewrite(
    query: string,
    reason: string,
  ): KnowledgeQueryRewriteResult {
    return {
      originalQuery: query,
      rewrittenQuery: query,
      keywords: [query],
      expandedQueries: [
        {
          index: 0,
          query,
          keywords: [query],
          angle: 'original',
        },
      ],
      changed: false,
      reason,
    };
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
              angle: 'original' as const,
            },
          ];

    return queries.slice(0, strategy.queryCount ?? 3).map((item, index) => ({
      ...item,
      index,
    }));
  }

  private async resolveHydeEmbedding(
    query: string,
    strategy: RetrievalStrategy,
    signal?: AbortSignal,
  ): Promise<number[] | undefined> {
    if (!strategy.useHyDE || !strategy.useVector) return undefined;
    const hypotheticalAnswer =
      await this.queryRewriteService.generateHypotheticalAnswer(query, signal);
    if (!hypotheticalAnswer.trim()) return undefined;

    return this.runtime.withTransientRetry(
      'embed hyde query',
      () => {
        throwIfAborted(signal);
        return this.runtime.embeddings.embedQuery(hypotheticalAnswer);
      },
      3,
    );
  }

  private async retrieveStage1ForKnowledge(
    knowledgeId: string,
    retrievalQueries: RetrievalQueryItem[],
    hydeQueryEmbedding: number[] | undefined,
    strategy: RetrievalStrategy,
    threshold: number,
    globalStage1TopK: number,
    signal?: AbortSignal,
  ): Promise<{ chunks: KnowledgeChunk[]; trace: RetrieveKnowledgeTraceItem[] }> {
    const perQueryTopK = Math.max(
      4,
      Math.ceil(globalStage1TopK / Math.max(retrievalQueries.length, 1)),
    );
    const results: KnowledgeChunk[][] = [];
    const trace: RetrieveKnowledgeTraceItem[] = [];

    for (const retrievalQuery of retrievalQueries) {
      throwIfAborted(signal);
      const queryEmbedding = strategy.useVector
        ? await this.runtime.withTransientRetry(
            'embed query',
            () => {
              throwIfAborted(signal);
              return this.runtime.embeddings.embedQuery(retrievalQuery.query);
            },
            3,
          )
        : undefined;

      const stage1Result = await this.retrieveStage1(
        knowledgeId,
        queryEmbedding,
        hydeQueryEmbedding,
        retrievalQuery.query,
        retrievalQuery.keywords,
        threshold,
        perQueryTopK,
        strategy,
      );
      const chunks = stage1Result.chunks.map((chunk) => ({
        ...chunk,
        matched_queries: Array.from(
          new Set([...(chunk.matched_queries ?? []), retrievalQuery.index]),
        ),
        keyword_backend: stage1Result.keywordBackend,
        vector_backend: 'pgvector' as const,
      }));
      results.push(chunks);
      trace.push({
        knowledgeId,
        queryIndex: retrievalQuery.index,
        query: retrievalQuery.query,
        keywords: retrievalQuery.keywords,
        angle: retrievalQuery.angle,
        vectorBackend: 'pgvector',
        keywordBackend: strategy.useKeyword
          ? stage1Result.keywordBackend
          : 'disabled',
        vectorResultCount: stage1Result.vectorResultCount,
        hydeVectorResultCount: stage1Result.hydeVectorResultCount,
        keywordResultCount: stage1Result.keywordResultCount,
        mergedResultCount: chunks.length,
        fallbackToPg: stage1Result.fallbackToPg,
        skippedChannels: stage1Result.skippedChannels,
      });
    }

    return {
      chunks: this.mergeStage1Results(results, globalStage1TopK),
      trace,
    };
  }

  private async retrieveStage1(
    knowledgeId: string,
    queryEmbedding: number[] | undefined,
    hydeQueryEmbedding: number[] | undefined,
    retrievalQuery: string,
    keywordTerms: string[],
    threshold: number,
    matchCount: number,
    strategy: RetrievalStrategy,
  ): Promise<HybridRetrieveResult> {
    return this.hybridRetriever.retrieve({
      knowledgeId,
      queryEmbedding,
      hydeQueryEmbedding,
      retrievalQuery,
      keywordTerms,
      threshold,
      matchCount,
      useVector: strategy.useVector,
      useKeyword: strategy.useKeyword,
      useExactPhrase: strategy.useExactPhrase,
    });
  }

  private mergeRetrievedChunk(
    current: KnowledgeChunk,
    incoming: KnowledgeChunk,
  ): KnowledgeChunk {
    const better = this.compareRetrievalChunks(incoming, current) > 0
      ? incoming
      : current;

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
    };
  }

  private compareRetrievalChunks(
    left: KnowledgeChunk,
    right: KnowledgeChunk,
  ): number {
    return (
      (left.hybrid_score ?? 0) - (right.hybrid_score ?? 0) ||
      (left.keyword_score ?? 0) - (right.keyword_score ?? 0) ||
      (left.similarity ?? 0) - (right.similarity ?? 0)
    );
  }

  private isAbortError(error: unknown): boolean {
    return (error as { name?: string })?.name === 'AbortError';
  }
}
