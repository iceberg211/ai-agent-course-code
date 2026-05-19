import { Injectable, Logger } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { normalizeRetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { extractFallbackKeywordTerms } from '@/knowledge-content/keyword-retrievers/keyword-retriever.utils';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { KnowledgeStage1RetrievalService } from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
import { PersonaStage1RetrievalService } from '@/knowledge-content/services/persona-stage1-retrieval.service';
import type {
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/knowledge-chunk-context-expansion.service';
import type { RetrievalStrategy } from '@/common/rag';

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly stage1RetrievalService: KnowledgeStage1RetrievalService,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
    private readonly chunkContextExpansionService: KnowledgeChunkContextExpansionService,
    private readonly personaStage1RetrievalService: PersonaStage1RetrievalService,
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
    const skipQueryRewrite =
      normalizedOptions.skipQueryRewrite || !strategy.useMultiQuery;
    normalizedOptions.strategy = strategy;
    normalizedOptions.skipQueryRewrite = skipQueryRewrite;

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
      skipQueryRewrite,
      options.signal,
    );
    throwIfAborted(options.signal);

    const retrievalQueries = this.resolveRetrievalQueries(rewrite, strategy);
    const stage1Result = await this.stage1RetrievalService.retrieveForKnowledge(
      {
        knowledgeId,
        retrievalQueries,
        strategy,
        threshold: normalizedOptions.threshold,
        globalStage1TopK: normalizedOptions.stage1TopK,
        signal: options.signal,
      },
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
        if (isAbortError(error)) {
          throw error;
        }

        this.logger.warn(
          `Reranker 失败，回退为向量检索结果：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    stage2 = await this.expandStage2Context(stage2, strategy);

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
    const normalizedQuery = query.trim();
    throwIfAborted(options.signal);

    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);
    const strategy = normalizeRetrievalStrategy(options.strategy);
    const skipQueryRewrite =
      normalizedOptions.skipQueryRewrite || !strategy.useMultiQuery;
    normalizedOptions.strategy = strategy;
    normalizedOptions.skipQueryRewrite = skipQueryRewrite;

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

    const rewrite = await this.resolveRetrievalQuery(
      normalizedQuery,
      skipQueryRewrite,
      options.signal,
    );
    throwIfAborted(options.signal);

    const retrievalQueries = this.resolveRetrievalQueries(rewrite, strategy);
    throwIfAborted(options.signal);

    const stage1Result = await this.personaStage1RetrievalService.retrieve({
      personaId,
      retrievalQueries,
      stage1TopK: options.stage1TopK,
      threshold: options.threshold,
      channels: {
        useVector: strategy.useVector,
        useKeyword: strategy.useKeyword,
        useGraph: strategy.useGraph,
        useExactPhrase: strategy.useExactPhrase,
      },
      signal: options.signal,
    });
    throwIfAborted(options.signal);

    if (stage1Result.knowledgeCount === 0) {
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

    const mergedStage1 = stage1Result.chunks;
    const stage1Trace = stage1Result.trace;
    if (mergedStage1.length <= 1 || !normalizedOptions.rerank) {
      const stage2 = await this.expandStage2Context(
        mergedStage1.slice(0, normalizedOptions.finalTopK),
        strategy,
      );
      const result = {
        query: normalizedQuery,
        retrievalQuery: rewrite.rewrittenQuery,
        retrievalQueries,
        rewrite,
        options: normalizedOptions,
        stage1Trace,
        stage1: mergedStage1,
        stage2,
      };
      return result;
    }

    try {
      const rerankedStage2 = await this.rerankerService.rerank(
        normalizedQuery,
        mergedStage1,
        normalizedOptions.finalTopK,
        options.signal,
      );
      const stage2 = await this.expandStage2Context(rerankedStage2, strategy);
      const result = {
        query: normalizedQuery,
        retrievalQuery: rewrite.rewrittenQuery,
        retrievalQueries,
        rewrite,
        options: normalizedOptions,
        stage1Trace,
        stage1: mergedStage1,
        stage2,
      };
      return result;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const stage2 = await this.expandStage2Context(
        mergedStage1.slice(0, normalizedOptions.finalTopK),
        strategy,
      );
      const result = {
        query: normalizedQuery,
        retrievalQuery: rewrite.rewrittenQuery,
        retrievalQueries,
        rewrite,
        options: normalizedOptions,
        stage1Trace,
        stage1: mergedStage1,
        stage2,
      };
      return result;
    }
  }

  private async resolveRetrievalQuery(
    query: string,
    skipQueryRewrite?: boolean,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    if (skipQueryRewrite) {
      return this.buildFallbackRewrite(query, '显式跳过 Query Rewrite');
    }
    return this.queryRewriteService.rewrite(query, signal);
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
      expandedQueries: [
        {
          index: 0,
          query,
          keywords,
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

  private async expandStage2Context(
    stage2: KnowledgeChunk[],
    strategy: RetrievalStrategy,
  ): Promise<KnowledgeChunk[]> {
    const window = strategy.chunkContextWindow ?? 0;
    if (window <= 0 || stage2.length === 0) {
      return stage2;
    }

    try {
      return await this.chunkContextExpansionService.expand(stage2, window);
    } catch (error) {
      this.logger.warn(
        `扩展相邻 chunk 上下文失败，保留原 stage2：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return stage2;
    }
  }

}
