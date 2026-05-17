import { Injectable, Logger, Optional } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/agent/agent.utils';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';
import {
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  DEFAULT_EMBEDDINGS_MODEL_NAME,
  DEFAULT_HYBRID_KEYWORD_BACKEND,
} from '@/common/constants';
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
import { DEFAULT_PARENT_CHILD_INDEX_VERSION } from '@/knowledge-content/parent-child/knowledge-parent-child-plan';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type {
  MountedKnowledgeConfig,
  PersonaSemanticCacheContext,
  PersonaSemanticCacheResolution,
} from '@/knowledge-content/services/knowledge-retrieval.types';
import type { RetrieveKnowledgeDebugResult } from '@/knowledge-content/types/knowledge-content.types';

@Injectable()
export class RagSemanticCacheCoordinatorService {
  private readonly logger = new Logger(RagSemanticCacheCoordinatorService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    @Optional()
    private readonly semanticCacheStore?: RagSemanticCacheStoreService,
  ) {}

  async resolve(input: {
    personaId: string;
    normalizedQuery: string;
    normalizedOptions: RetrieveKnowledgeDebugResult['options'];
    strategy: RetrievalStrategy;
    knowledgeConfigs: MountedKnowledgeConfig[];
    signal?: AbortSignal;
  }): Promise<PersonaSemanticCacheResolution> {
    if (!this.semanticCacheStore?.isEnabled()) {
      return { context: null };
    }

    try {
      const mountedKnowledgeBases =
        await this.buildMountedKnowledgeBaseFingerprints(
          input.knowledgeConfigs,
        );
      if (mountedKnowledgeBases.length !== input.knowledgeConfigs.length) {
        return { context: null };
      }

      const keyResult = buildRagSemanticCacheKey({
        query: input.normalizedQuery,
        personaId: input.personaId,
        mountedKnowledgeBases,
        retrievalConfig: input.normalizedOptions,
        embeddingModel: this.readEmbeddingModelName(),
        rerankerProvider: this.readRerankerProvider(),
        rerankerModel: this.readRerankerModel(),
        allowWeb: input.strategy.allowWeb,
        strategyFlags: input.strategy,
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

      if (!input.strategy.useVector) {
        return { context };
      }

      context.queryEmbedding = await this.runtime.withTransientRetry(
        'embed semantic cache query',
        () => {
          throwIfAborted(input.signal);
          return this.runtime.embeddings.embedQuery(input.normalizedQuery);
        },
        3,
      );
      throwIfAborted(input.signal);

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
      if (isAbortError(error)) {
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

  async write(
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
      if (isAbortError(error)) {
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

    return result;
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
      retrievalConfig: keyResult.material.retrievalConfig as unknown as Record<
        string,
        unknown
      >,
      models: {
        embeddingModel: keyResult.material.embeddingModel,
        rerankerProvider: keyResult.material.rerankerProvider,
        rerankerModel: keyResult.material.rerankerModel,
      },
      strategyFlags: keyResult.material.strategyFlags as unknown as Record<
        string,
        unknown
      >,
      indexVersions: keyResult.material.indexVersions as unknown as Record<
        string,
        unknown
      >,
    };
  }

  private buildSemanticCacheBackend(
    strategy: RetrievalStrategy,
  ): Record<string, unknown> {
    return {
      vector: strategy.useVector ? 'pgvector' : 'disabled',
      keyword: strategy.useKeyword ? this.readKeywordBackendName() : 'disabled',
      graph: strategy.useGraph ? 'neo4j' : 'disabled',
    };
  }

  private readEmbeddingModelName(): string {
    return (
      readNonEmptyEnv('EMBEDDINGS_MODEL_NAME') ?? DEFAULT_EMBEDDINGS_MODEL_NAME
    );
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
      readNonEmptyEnv('HYBRID_KEYWORD_BACKEND') ??
      DEFAULT_HYBRID_KEYWORD_BACKEND
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
      graph: readNonEmptyEnv('NEO4J_GRAPH_SCHEMA_VERSION'),
      parentChild:
        readNonEmptyEnv('PARENT_CHILD_INDEX_VERSION') ??
        DEFAULT_PARENT_CHILD_INDEX_VERSION,
      chunking:
        readNonEmptyEnv('KNOWLEDGE_CHUNKING_VERSION') ??
        'markdown-structure-v1',
    };
  }
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
