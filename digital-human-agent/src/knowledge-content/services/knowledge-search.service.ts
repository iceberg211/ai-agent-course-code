import { Injectable, Logger, Optional } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import { normalizeRetrievalStrategy } from '@/agent/retrieval-strategy.utils';
import {
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  DEFAULT_EMBEDDINGS_MODEL_NAME,
  DEFAULT_HYBRID_KEYWORD_BACKEND,
} from '@/common/constants';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import {
  buildMountedKnowledgeBaseCacheFingerprint,
  buildRagSemanticCacheKey,
  type MountedKnowledgeBaseCacheFingerprint,
  type RagSemanticCacheKeyResult,
} from '@/knowledge-content/cache/rag-semantic-cache-key';
import {
  RagSemanticCacheStoreService,
  type RagSemanticCacheLookupResult,
  type RagSemanticCachePayload,
  type RagSemanticCacheScope,
} from '@/knowledge-content/cache/rag-semantic-cache-store.service';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type {
  KeywordBackend,
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  RetrieveKnowledgeTraceItem,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/knowledge-chunk-context-expansion.service';
import { KnowledgeGraphRetrieverService } from '@/knowledge-content/graph/knowledge-graph-retriever.service';
import { DEFAULT_PARENT_CHILD_INDEX_VERSION } from '@/knowledge-content/parent-child/knowledge-parent-child-plan';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';
import type { HybridRetrieveResult } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';

interface MountedKnowledgeConfig {
  knowledgeId: string;
  threshold: number;
  stage1TopK: number;
  retrievalConfig: Partial<KnowledgeRetrievalConfig>;
  updatedAt: string | null;
}

interface PersonaSemanticCacheContext {
  keyResult: RagSemanticCacheKeyResult;
  scope: RagSemanticCacheScope;
  mountedKnowledgeBaseIds: string[];
  queryEmbedding?: number[];
}

interface PersonaSemanticCacheResolution {
  context: PersonaSemanticCacheContext | null;
  cachedResult?: RetrieveKnowledgeDebugResult;
}

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly hybridRetriever: KnowledgeHybridRetrieverService,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
    private readonly chunkContextExpansionService: KnowledgeChunkContextExpansionService,
    private readonly semanticCacheStore?: RagSemanticCacheStoreService,
    @Optional()
    private readonly graphRetriever?: KnowledgeGraphRetrieverService,
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
      options.skipQueryRewrite,
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
          skipQueryRewrite: options.skipQueryRewrite,
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

    const cacheResolution = await this.resolvePersonaSemanticCache(
      personaId,
      normalizedQuery,
      normalizedOptions,
      strategy,
      knowledgeConfigs,
      options.signal,
    );
    if (cacheResolution.cachedResult) {
      return cacheResolution.cachedResult;
    }
    const semanticCacheContext = cacheResolution.context;

    const rewrite = await this.resolveRetrievalQuery(
      normalizedQuery,
      options.skipQueryRewrite,
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
      return this.writePersonaSemanticCache(
        semanticCacheContext,
        strategy,
        result,
      );
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
      return this.writePersonaSemanticCache(
        semanticCacheContext,
        strategy,
        result,
      );
    } catch (error) {
      if (this.isAbortError(error)) {
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
      return this.writePersonaSemanticCache(
        semanticCacheContext,
        strategy,
        result,
      );
    }
  }

  private async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<MountedKnowledgeConfig[]> {
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
        .select('id, retrieval_config, updated_at')
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
        retrievalConfig: config,
        updatedAt:
          typeof knowledge.updated_at === 'string' ? knowledge.updated_at : null,
      };
    });
  }

  private async resolvePersonaSemanticCache(
    personaId: string,
    normalizedQuery: string,
    normalizedOptions: RetrieveKnowledgeDebugResult['options'],
    strategy: RetrievalStrategy,
    knowledgeConfigs: MountedKnowledgeConfig[],
    signal?: AbortSignal,
  ): Promise<PersonaSemanticCacheResolution> {
    if (!this.semanticCacheStore?.isEnabled()) {
      return { context: null };
    }

    try {
      const mountedKnowledgeBases =
        await this.buildMountedKnowledgeBaseFingerprints(knowledgeConfigs);
      if (mountedKnowledgeBases.length !== knowledgeConfigs.length) {
        return { context: null };
      }

      const keyResult = buildRagSemanticCacheKey({
        query: normalizedQuery,
        personaId,
        mountedKnowledgeBases,
        retrievalConfig: normalizedOptions,
        embeddingModel: this.readEmbeddingModelName(),
        rerankerProvider: this.readRerankerProvider(),
        rerankerModel: this.readRerankerModel(),
        allowWeb: strategy.allowWeb,
        strategyFlags: strategy,
        indexVersions: this.readIndexVersions(),
      });
      const scope = this.buildSemanticCacheScope(keyResult);
      const context: PersonaSemanticCacheContext = {
        keyResult,
        scope,
        mountedKnowledgeBaseIds: keyResult.material.mountedKnowledgeBaseIds,
      };

      const exactHit = await this.semanticCacheStore.getByKey(keyResult.key);
      const exactResult = this.toCachedDebugResult(exactHit, 'exact-hit');
      if (exactResult) {
        return { context, cachedResult: exactResult };
      }

      if (!strategy.useVector) {
        return { context };
      }

      context.queryEmbedding = await this.runtime.withTransientRetry(
        'embed semantic cache query',
        () => {
          throwIfAborted(signal);
          return this.runtime.embeddings.embedQuery(normalizedQuery);
        },
        3,
      );
      throwIfAborted(signal);

      const similarHit = await this.semanticCacheStore.findSimilar({
        ...scope,
        queryEmbedding: context.queryEmbedding,
      });
      const similarResult = this.toCachedDebugResult(similarHit, 'similar-hit');
      if (similarResult) {
        return { context, cachedResult: similarResult };
      }

      return { context };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `RAG 语义缓存查询失败，继续走实时检索：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { context: null };
    }
  }

  private async buildMountedKnowledgeBaseFingerprints(
    knowledgeConfigs: MountedKnowledgeConfig[],
  ): Promise<MountedKnowledgeBaseCacheFingerprint[]> {
    const knowledgeIds = knowledgeConfigs.map((config) => config.knowledgeId);
    const { data: documentRows, error } = await this.runtime.supabase
      .from('knowledge_document')
      .select('id, knowledge_base_id, status, chunk_count, created_at')
      .in('knowledge_base_id', knowledgeIds);

    if (error) {
      this.logger.warn(`查询知识文档统计失败：${error.message}`);
      return [];
    }

    const statsByKnowledgeId = new Map<
      string,
      {
        documentCount: number;
        completedDocumentCount: number;
        chunkCount: number;
        maxDocumentCreatedAt: string | null;
      }
    >();

    for (const row of documentRows ?? []) {
      if (!isRecord(row)) continue;
      const knowledgeId = readString(row.knowledge_base_id);
      if (!knowledgeId) continue;

      const current = statsByKnowledgeId.get(knowledgeId) ?? {
        documentCount: 0,
        completedDocumentCount: 0,
        chunkCount: 0,
        maxDocumentCreatedAt: null,
      };
      current.documentCount += 1;
      if (readString(row.status) === 'completed') {
        current.completedDocumentCount += 1;
      }
      current.chunkCount += readNumber(row.chunk_count);
      current.maxDocumentCreatedAt = maxIsoDate(
        current.maxDocumentCreatedAt,
        readString(row.created_at),
      );
      statsByKnowledgeId.set(knowledgeId, current);
    }

    return knowledgeConfigs.map((config) => {
      const stats = statsByKnowledgeId.get(config.knowledgeId) ?? {
        documentCount: 0,
        completedDocumentCount: 0,
        chunkCount: 0,
        maxDocumentCreatedAt: null,
      };

      return buildMountedKnowledgeBaseCacheFingerprint({
        id: config.knowledgeId,
        updatedAt: config.updatedAt,
        documentCount: stats.documentCount,
        completedDocumentCount: stats.completedDocumentCount,
        chunkCount: stats.chunkCount,
        maxDocumentCreatedAt: stats.maxDocumentCreatedAt,
        maxChunkCreatedAt: null,
        retrievalConfig: config.retrievalConfig,
        indexVersions: this.readIndexVersions(),
      });
    });
  }

  private toCachedDebugResult(
    hit: RagSemanticCacheLookupResult | null,
    lookup: 'exact-hit' | 'similar-hit',
  ): RetrieveKnowledgeDebugResult | null {
    if (!hit) return null;

    const result = this.readCachedDebugPayload(hit.payload);
    if (!result) {
      this.logger.warn(`RAG 语义缓存 payload 无法恢复：${hit.cacheKey}`);
      return null;
    }

    return {
      ...result,
      cache: {
        enabled: true,
        lookup,
        cacheKey: hit.cacheKey,
        similarity: hit.similarity,
        written: false,
      },
    };
  }

  private readCachedDebugPayload(
    payload: RagSemanticCachePayload,
  ): Omit<RetrieveKnowledgeDebugResult, 'cache'> | null {
    const result = payload.result;
    if (!isRecord(result)) return null;
    if (
      !Array.isArray(result.retrievalQueries) ||
      !isRecord(result.rewrite) ||
      !isRecord(result.options) ||
      !Array.isArray(result.stage1Trace) ||
      !Array.isArray(result.stage1) ||
      !Array.isArray(result.stage2)
    ) {
      return null;
    }

    return result as Omit<RetrieveKnowledgeDebugResult, 'cache'>;
  }

  private async writePersonaSemanticCache(
    context: PersonaSemanticCacheContext | null,
    strategy: RetrievalStrategy,
    result: Omit<RetrieveKnowledgeDebugResult, 'cache'>,
  ): Promise<RetrieveKnowledgeDebugResult> {
    if (!context || !this.semanticCacheStore?.isEnabled()) {
      return result;
    }

    if (!context.queryEmbedding || context.queryEmbedding.length === 0) {
      return {
        ...result,
        cache: {
          enabled: true,
          lookup: 'miss',
          cacheKey: context.keyResult.key,
          written: false,
          reason: 'missing-query-embedding',
        },
      };
    }

    try {
      const writeResult = await this.semanticCacheStore.upsert({
        ...context.scope,
        cacheKey: context.keyResult.key,
        normalizedQueryHash: context.keyResult.material.normalizedQueryHash,
        query: result.query,
        queryEmbedding: context.queryEmbedding,
        mountedKnowledgeBaseIds: context.mountedKnowledgeBaseIds,
        backend: this.buildSemanticCacheBackend(strategy),
        payload: this.buildSemanticCachePayload(result),
      });

      return {
        ...result,
        cache: {
          enabled: true,
          lookup: 'miss',
          cacheKey: context.keyResult.key,
          written: writeResult.written,
          reason: writeResult.reason,
        },
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `RAG 语义缓存写入失败，返回实时检索结果：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ...result,
        cache: {
          enabled: true,
          lookup: 'miss',
          cacheKey: context.keyResult.key,
          written: false,
          reason: 'cache-write-error',
        },
      };
    }
  }

  private buildSemanticCachePayload(
    result: Omit<RetrieveKnowledgeDebugResult, 'cache'>,
  ): RagSemanticCachePayload {
    return {
      result,
      stage1ChunkIds: result.stage1.map((chunk) => chunk.id),
      stage2ChunkIds: result.stage2.map((chunk) => chunk.id),
      compressedContext: result.stage2
        .map(
          (chunk, index) =>
            `[${index + 1}] ${chunk.source}#${chunk.chunk_index}\n${chunk.content}`,
        )
        .join('\n\n')
        .slice(0, 12000),
      trace: {
        retrievalQueries: result.retrievalQueries,
        stage1Trace: result.stage1Trace,
      },
    };
  }

  private buildSemanticCacheScope(
    keyResult: RagSemanticCacheKeyResult,
  ): RagSemanticCacheScope {
    return {
      personaId: keyResult.material.personaId,
      mountedKnowledgeBaseFingerprints:
        keyResult.material.mountedKnowledgeBaseFingerprints,
      retrievalConfig: keyResult.material
        .retrievalConfig as unknown as Record<string, unknown>,
      models: {
        embeddingModel: keyResult.material.embeddingModel,
        rerankerProvider: keyResult.material.rerankerProvider,
        rerankerModel: keyResult.material.rerankerModel,
      },
      strategyFlags: keyResult.material
        .strategyFlags as unknown as Record<string, unknown>,
      indexVersions: keyResult.material
        .indexVersions as unknown as Record<string, unknown>,
    };
  }

  private buildSemanticCacheBackend(
    strategy: RetrievalStrategy,
  ): Record<string, unknown> {
    return {
      vector: strategy.useVector ? 'pgvector' : 'disabled',
      keyword: strategy.useKeyword ? this.readKeywordBackendName() : 'disabled',
      graph: strategy.useGraph ? 'postgres-graph-index' : 'disabled',
    };
  }

  private readEmbeddingModelName(): string {
    return readNonEmptyEnv('EMBEDDINGS_MODEL_NAME') ?? DEFAULT_EMBEDDINGS_MODEL_NAME;
  }

  private readRerankerProvider(): string {
    return readNonEmptyEnv('RERANKER_PROVIDER') ?? 'llm-json';
  }

  private readRerankerModel(): string | null {
    return (
      readNonEmptyEnv('RERANKER_MODEL') ??
      readNonEmptyEnv('RERANKER_MODEL_NAME')
    );
  }

  private readKeywordBackendName(): string {
    return (
      readNonEmptyEnv('HYBRID_KEYWORD_BACKEND') ?? DEFAULT_HYBRID_KEYWORD_BACKEND
    );
  }

  private readIndexVersions(): {
    elasticsearch: string | null;
    graph: string | null;
    parentChild: string | null;
    chunking: string | null;
  } {
    return {
      elasticsearch:
        readNonEmptyEnv('ELASTICSEARCH_INDEX_VERSION') ??
        DEFAULT_ELASTICSEARCH_INDEX_VERSION,
      graph: readNonEmptyEnv('GRAPH_INDEX_VERSION'),
      parentChild:
        readNonEmptyEnv('PARENT_CHILD_INDEX_VERSION') ??
        DEFAULT_PARENT_CHILD_INDEX_VERSION,
      chunking:
        readNonEmptyEnv('KNOWLEDGE_CHUNKING_VERSION') ??
        'markdown-structure-v1',
    };
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
      const keywordBackend: KeywordBackend | undefined =
        stage1Result.keywordBackend === 'disabled'
          ? undefined
          : stage1Result.keywordBackend;
      const chunks = stage1Result.chunks.map((chunk) => ({
        ...chunk,
        matched_queries: Array.from(
          new Set([...(chunk.matched_queries ?? []), retrievalQuery.index]),
        ),
        keyword_backend: keywordBackend ?? chunk.keyword_backend,
        vector_backend: this.resolveChunkVectorBackend(chunk),
      }));
      results.push(chunks);
      trace.push({
        knowledgeId,
        queryIndex: retrievalQuery.index,
        query: retrievalQuery.query,
        keywords: retrievalQuery.keywords,
        angle: retrievalQuery.angle,
        vectorBackend: strategy.useVector ? 'pgvector' : 'disabled',
        keywordBackend: strategy.useKeyword
          ? stage1Result.keywordBackend
          : 'disabled',
        vectorResultCount: stage1Result.vectorResultCount,
        hydeVectorResultCount: stage1Result.hydeVectorResultCount,
        keywordResultCount: stage1Result.keywordResultCount,
        graphResultCount: stage1Result.graphResultCount,
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
  ): Promise<HybridRetrieveResult & { graphResultCount: number }> {
    const hybridResult =
      strategy.useVector || strategy.useKeyword
        ? await this.hybridRetriever.retrieve({
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
          })
        : this.buildSkippedHybridResult(strategy);

    const graphChunks = await this.retrieveGraphChunks(
      knowledgeId,
      retrievalQuery,
      keywordTerms,
      matchCount,
      strategy,
    );
    const skippedChannels = new Set(hybridResult.skippedChannels);
    if (!strategy.useGraph || !this.graphRetriever) {
      skippedChannels.add('graph');
    }

    return {
      ...hybridResult,
      chunks: this.mergeStage1Results(
        [hybridResult.chunks, graphChunks],
        matchCount,
      ),
      graphResultCount: graphChunks.length,
      skippedChannels: Array.from(skippedChannels),
    };
  }

  private buildSkippedHybridResult(
    strategy: RetrievalStrategy,
  ): HybridRetrieveResult {
    const skippedChannels = new Set<
      'vector' | 'keyword' | 'hyde' | 'graph'
    >();
    if (!strategy.useVector) {
      skippedChannels.add('vector');
      skippedChannels.add('hyde');
    } else if (!strategy.useHyDE) {
      skippedChannels.add('hyde');
    }
    if (!strategy.useKeyword) skippedChannels.add('keyword');

    return {
      chunks: [],
      keywordBackend: 'disabled',
      vectorResultCount: 0,
      hydeVectorResultCount: 0,
      keywordResultCount: 0,
      fallbackToPg: false,
      skippedChannels: Array.from(skippedChannels),
    };
  }

  private async retrieveGraphChunks(
    knowledgeId: string,
    retrievalQuery: string,
    keywordTerms: string[],
    matchCount: number,
    strategy: RetrievalStrategy,
  ): Promise<KnowledgeChunk[]> {
    if (!strategy.useGraph || !this.graphRetriever) return [];

    try {
      return await this.graphRetriever.retrieve({
        knowledgeId,
        retrievalQuery,
        keywordTerms,
        matchCount,
        graphMaxHops: strategy.graphMaxHops,
        graphMode: strategy.graphMode,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `GraphRetriever 失败，继续使用其他检索通道：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async expandStage2Context(
    stage2: KnowledgeChunk[],
    strategy: RetrievalStrategy,
  ): Promise<KnowledgeChunk[]> {
    if (strategy.parentContext) {
      try {
        return await this.chunkContextExpansionService.expandParentContext(
          stage2,
          strategy.parentContextMaxChars ?? 2000,
        );
      } catch (error) {
        this.logger.warn(
          `扩展 parent context 失败，保留原 stage2：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return stage2;
      }
    }

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

  private resolveChunkVectorBackend(
    chunk: KnowledgeChunk,
  ): KnowledgeChunk['vector_backend'] {
    if (chunk.vector_backend) {
      return chunk.vector_backend;
    }

    const sources = chunk.retrieval_sources ?? [];
    if (sources.includes('vector') || sources.includes('hyde')) {
      return 'pgvector';
    }

    return undefined;
  }

  private compareRetrievalChunks(
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

  private isAbortError(error: unknown): boolean {
    return (error as { name?: string })?.name === 'AbortError';
  }
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

function readNonEmptyEnv(key: string): string | null {
  const value = String(process.env[key] ?? '').trim();
  return value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function maxIsoDate(left: string | null, right: string): string | null {
  if (!right) return left;
  if (!left) return right;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}
