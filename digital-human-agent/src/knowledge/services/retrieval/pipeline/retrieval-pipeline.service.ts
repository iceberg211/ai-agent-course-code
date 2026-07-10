import { Injectable, Logger, Optional } from '@nestjs/common';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import { GraphExpandService } from '@/knowledge/services/retrieval/pipeline/graph-expand.service';
import type {
  GraphExpandTraceItem,
  RetrievalPort,
  RetrievalPortRequest,
  RetrievalPortResponse,
} from '@/knowledge/services/retrieval/pipeline/retrieval-port';
import { mergeHybridResults } from '@/knowledge/services/retrieval/channels/knowledge-retrieval-fusion';
import { AclEpochService } from '@/knowledge/services/retrieval/pipeline/acl-epoch.service';
import { RagRetrievalCacheService } from '@/knowledge/services/retrieval/pipeline/rag-retrieval-cache.service';
import {
  buildAclSnapshot,
  hashAclSnapshot,
  hashQueryKey,
  type AclSnapshot,
} from '@/common/rag/acl-snapshot';
import { PersonaKbConfigService } from '@/knowledge/services/manage/persona-kb-config.service';
import { createAbortError, isAbortError } from '@/common/utils';
import { KnowledgeCacheRevisionService } from '@/common/rag/knowledge-cache-revision.service';
import type { MountedKnowledgeConfig } from '@/knowledge/types/knowledge-content.types';

type ResolvedRetrievalScope = {
  kind: 'persona' | 'knowledge' | 'knowledge_ids';
  personaId?: string;
  knowledgeId?: string;
  knowledgeIds?: string[];
  cacheScopeKey: string;
  knowledgeCountHint: number;
};

type RetrievalCacheInput = {
  profileId: string;
  personaId: string;
  scopeKey: string;
  queryKeyParts: string[];
  aclSnapshot: AclSnapshot;
};

/**
 * 统一检索端口实现：Hybrid 多路召回 + 可选 Graph 一跳 expand + ACL 安全缓存。
 * Agent 与 Search 均经此入口，避免双栈漂移。
 */
@Injectable()
export class RetrievalPipelineService implements RetrievalPort {
  private readonly logger = new Logger(RetrievalPipelineService.name);
  /**
   * 本进程内相同缓存键的未完成检索。Redis 只缓存完成结果；该表用于抵消缓存未命中时的瞬时并发。
   */
  private readonly inFlightRetrievals = new Map<
    string,
    Promise<RetrievalPortResponse>
  >();

  constructor(
    private readonly hybridRetriever: HybridRetrieverService,
    private readonly graphExpandService: GraphExpandService,
    @Optional()
    private readonly aclEpochService?: AclEpochService,
    @Optional()
    private readonly retrievalCache?: RagRetrievalCacheService,
    @Optional()
    private readonly personaKbConfigService?: PersonaKbConfigService,
    @Optional()
    private readonly knowledgeCacheRevisionService?: KnowledgeCacheRevisionService,
  ) {}

  async retrieve(
    request: RetrievalPortRequest,
  ): Promise<RetrievalPortResponse> {
    const scope = this.resolveScope(request);
    if (!scope) {
      return {
        chunks: [],
        trace: [],
        knowledgeCount: 0,
        graphExpandTrace: [
          {
            knowledgeId: '*',
            matchedEntities: [],
            expandedChunkIds: [],
            expandedChunkCount: 0,
            skipped: true,
            reason: 'missing_scope',
          },
        ],
      };
    }

    const cacheProfile = (request.profileId ?? 'default').trim() || 'default';

    let aclEpochByKb: Record<string, number> = {};
    let epochsResolved = false;
    let knowledgeRevisions: Record<string, number> = {};
    let revisionsResolved = false;
    let mountedKnowledgeConfigs: MountedKnowledgeConfig[] | undefined;
    if (this.aclEpochService) {
      try {
        const resolvedScope = await this.resolveKnowledgeScopeForCache(scope);
        const kbIds = resolvedScope.knowledgeIds;
        mountedKnowledgeConfigs = resolvedScope.mountedKnowledgeConfigs;
        aclEpochByKb = await this.aclEpochService.getEpochs(kbIds);
        epochsResolved = true;
        if (this.knowledgeCacheRevisionService) {
          const revisions =
            await this.knowledgeCacheRevisionService.getRevisions(kbIds);
          if (revisions) {
            knowledgeRevisions = revisions;
            revisionsResolved = true;
          }
        }
      } catch (error) {
        this.logger.debug(
          `加载 acl epoch 失败，跳过 retrieval 缓存：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const aclSnapshot = buildAclSnapshot(request.accessScope, aclEpochByKb);
    const cacheInput = {
      profileId: cacheProfile,
      personaId:
        scope.kind === 'persona' ? (scope.personaId ?? '') : '',
      scopeKey: scope.cacheScopeKey,
      queryKeyParts: this.buildCacheQueryKeyParts(
        request,
        scope.cacheScopeKey,
        knowledgeRevisions,
      ),
      aclSnapshot,
    };

    const cacheable = Boolean(
      this.retrievalCache && epochsResolved && revisionsResolved,
    );
    if (cacheable && this.retrievalCache) {
      const cached = await this.retrievalCache.getRetrievalResult(cacheInput);
      if (cached !== null) {
        return {
          chunks: cached.chunks,
          trace: [],
          knowledgeCount:
            cached.knowledgeCount ??
            (cached.chunks.length > 0
              ? Math.max(scope.knowledgeCountHint, 1)
              : 0),
          rerankLimit: cached.rerankLimit,
          graphExpandTrace: [
            {
              knowledgeId: '*',
              matchedEntities: [],
              expandedChunkIds: [],
              expandedChunkCount: 0,
              skipped: true,
              reason: 'retrieval_cache_hit',
            },
          ],
        };
      }
    }

    if (!cacheable) {
      return this.retrieveUncached(
        scope,
        request,
        cacheInput,
        false,
        mountedKnowledgeConfigs,
      );
    }

    const inFlightKey = this.buildInFlightKey(cacheInput);
    let shared = this.inFlightRetrievals.get(inFlightKey);
    if (!shared) {
      // 共享的底层检索不绑定首个调用方的 signal，避免其中一个 HTTP/WS 断开取消其他等价请求。
      shared = this.retrieveUncached(
        scope,
        { ...request, signal: undefined },
        cacheInput,
        true,
        mountedKnowledgeConfigs,
      ).finally(() => {
        this.inFlightRetrievals.delete(inFlightKey);
      });
      this.inFlightRetrievals.set(inFlightKey, shared);
    }

    return this.waitForSharedRetrieval(shared, request.signal);
  }

  private async retrieveUncached(
    scope: ResolvedRetrievalScope,
    request: RetrievalPortRequest,
    cacheInput: RetrievalCacheInput,
    cacheable: boolean,
    mountedKnowledgeConfigs?: MountedKnowledgeConfig[],
  ): Promise<RetrievalPortResponse> {
    const hybrid = await this.loadHybrid(scope, request, mountedKnowledgeConfigs);

    let chunks = hybrid.chunks;
    let graphExpandTrace: GraphExpandTraceItem[] = [
      {
        knowledgeId: '*',
        matchedEntities: [],
        expandedChunkIds: [],
        expandedChunkCount: 0,
        skipped: true,
        reason: 'graphExpand=false',
      },
    ];

    if (request.graphExpand) {
      const expand = await this.graphExpandService.expand({
        documents: hybrid.chunks,
        question: request.question ?? request.retrievalQueries[0]?.query ?? '',
        currentQuery: request.currentQuery,
        useGraphChannel: request.strategy.useGraph === true,
        graphExpand: true,
        accessScope: request.accessScope,
        signal: request.signal,
      });
      chunks =
        expand.expandedChunks.length > 0
          ? mergeHybridResults(
              [hybrid.chunks, expand.expandedChunks],
              Math.max(hybrid.chunks.length + expand.expandedChunks.length, 20),
            )
          : hybrid.chunks;
      graphExpandTrace = expand.trace as GraphExpandTraceItem[];
      if (expand.expandedChunks.length > 0) {
        this.logger.debug(
          `Graph expand 合并 ${expand.expandedChunks.length} 条邻居证据`,
        );
      }
    }

    if (cacheable && this.retrievalCache) {
      void this.retrievalCache.setRetrievalResult({
        ...cacheInput,
        chunks,
        knowledgeCount: hybrid.knowledgeCount,
        rerankLimit: hybrid.rerankLimit,
      });
    }

    return {
      chunks,
      trace: hybrid.trace,
      knowledgeCount: hybrid.knowledgeCount,
      rerankLimit: hybrid.rerankLimit,
      graphExpandTrace,
    };
  }

  private buildInFlightKey(input: RetrievalCacheInput): string {
    return [
      input.profileId || 'default',
      input.personaId || input.scopeKey || 'none',
      hashAclSnapshot(input.aclSnapshot),
      hashQueryKey(input.queryKeyParts),
    ].join(':');
  }

  private waitForSharedRetrieval(
    shared: Promise<RetrievalPortResponse>,
    signal?: AbortSignal,
  ): Promise<RetrievalPortResponse> {
    if (!signal) return shared;
    if (signal.aborted) return Promise.reject(createAbortError());

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(createAbortError());
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      void shared.then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private resolveScope(
    request: RetrievalPortRequest,
  ): ResolvedRetrievalScope | null {
    if (request.personaId?.trim()) {
      const personaId = request.personaId.trim();
      return {
        kind: 'persona',
        personaId,
        cacheScopeKey: `persona:${personaId}`,
        knowledgeCountHint: 1,
      };
    }
    if (request.knowledgeId?.trim()) {
      const knowledgeId = request.knowledgeId.trim();
      return {
        kind: 'knowledge',
        knowledgeId,
        cacheScopeKey: `kb:${knowledgeId}`,
        knowledgeCountHint: 1,
      };
    }
    const ids = Array.from(
      new Set((request.knowledgeIds ?? []).map((id) => id.trim()).filter(Boolean)),
    );
    if (ids.length > 0) {
      return {
        kind: 'knowledge_ids',
        knowledgeIds: ids,
        cacheScopeKey: `kbs:${ids.slice().sort().join(',')}`,
        knowledgeCountHint: ids.length,
      };
    }
    return null;
  }

  /**
   * 缓存只复用“完全相同召回语义”的结果。
   * 不包含 reason 等说明性字段，避免无意义降低命中率；其余所有影响候选集的字段必须参与 key。
   */
  private buildCacheQueryKeyParts(
    request: RetrievalPortRequest,
    scopeKey: string,
    knowledgeRevisions: Record<string, number>,
  ): string[] {
    const strategy = request.strategy;
    const strategyKey = JSON.stringify({
      name: strategy.name,
      needRetrieval: strategy.needRetrieval,
      useVector: strategy.useVector,
      useKeyword: strategy.useKeyword,
      useGraph: strategy.useGraph,
      useExactPhrase: strategy.useExactPhrase,
      useMultiQuery: strategy.useMultiQuery,
      queryCount: strategy.queryCount ?? null,
      chunkContextWindow: strategy.chunkContextWindow ?? null,
      graphMode: strategy.graphMode ?? null,
      graphMaxHops: strategy.graphMaxHops ?? null,
      useMemory: strategy.useMemory,
      useMultimodal: strategy.useMultimodal,
      vectorTopK: strategy.vectorTopK,
      keywordTopK: strategy.keywordTopK,
      graphTopK: strategy.graphTopK,
      memoryTopK: strategy.memoryTopK,
      rrfK: strategy.rrfK,
    });

    return [
      ...request.retrievalQueries.map(
        (q) => `${q.index}:${q.query}:${(q.keywords ?? []).join(',')}:${q.angle}`,
      ),
      `question=${request.question ?? ''}`,
      `currentQuery=${request.currentQuery ?? ''}`,
      `threshold=${request.threshold ?? 'default'}`,
      `retrievalLimit=${request.retrievalLimit ?? 'default'}`,
      `graphExpand=${request.graphExpand === true}`,
      `strategy=${strategyKey}`,
      `knowledgeRevisions=${Object.keys(knowledgeRevisions)
        .sort()
        .map((id) => `${id}:${knowledgeRevisions[id] ?? 0}`)
        .join('|')}`,
      scopeKey,
    ];
  }

  private async resolveKnowledgeScopeForCache(
    scope: ResolvedRetrievalScope,
  ): Promise<{
    knowledgeIds: string[];
    mountedKnowledgeConfigs?: MountedKnowledgeConfig[];
  }> {
    if (scope.kind === 'knowledge' && scope.knowledgeId) {
      return { knowledgeIds: [scope.knowledgeId] };
    }
    if (scope.kind === 'knowledge_ids' && scope.knowledgeIds) {
      return { knowledgeIds: scope.knowledgeIds };
    }
    if (
      scope.kind === 'persona' &&
      scope.personaId &&
      this.personaKbConfigService
    ) {
      const mountedKnowledgeConfigs =
        await this.personaKbConfigService.listMountedKnowledgeConfigs(
          scope.personaId,
        );
      return {
        knowledgeIds: mountedKnowledgeConfigs.map((c) => c.knowledgeId),
        mountedKnowledgeConfigs,
      };
    }
    return { knowledgeIds: [] };
  }

  private async loadHybrid(
    scope: ResolvedRetrievalScope,
    request: RetrievalPortRequest,
    mountedKnowledgeConfigs?: MountedKnowledgeConfig[],
  ): Promise<{
    chunks: RetrievalPortResponse['chunks'];
    trace: RetrievalPortResponse['trace'];
    knowledgeCount: number;
    rerankLimit?: number;
  }> {
    if (scope.kind === 'persona' && scope.personaId) {
      const hybrid = await this.hybridRetriever.retrieveForPersona({
        personaId: scope.personaId,
        mountedKnowledgeConfigs,
        retrievalQueries: request.retrievalQueries,
        strategy: request.strategy,
        accessScope: request.accessScope,
        retrievalLimit: request.retrievalLimit,
        threshold: request.threshold,
        signal: request.signal,
      });
      return {
        chunks: hybrid.chunks,
        trace: hybrid.trace,
        knowledgeCount: hybrid.knowledgeCount,
        rerankLimit: hybrid.rerankLimit,
      };
    }

    if (scope.kind === 'knowledge' && scope.knowledgeId) {
      const hybrid = await this.hybridRetriever.retrieveForKnowledge({
        knowledgeId: scope.knowledgeId,
        retrievalQueries: request.retrievalQueries,
        strategy: request.strategy,
        threshold: request.threshold ?? 0.6,
        globalRetrievalLimit: request.retrievalLimit ?? 20,
        accessScope: request.accessScope,
        applyAccessScope: false,
        signal: request.signal,
      });
      return {
        chunks: hybrid.chunks,
        trace: hybrid.trace,
        knowledgeCount: 1,
      };
    }

    const knowledgeIds = scope.knowledgeIds ?? [];
    if (knowledgeIds.length === 0) {
      return { chunks: [], trace: [], knowledgeCount: 0 };
    }

    const attempts = await Promise.all(
      knowledgeIds.map(async (knowledgeId) => {
        try {
          return await this.hybridRetriever.retrieveForKnowledge({
            knowledgeId,
            retrievalQueries: request.retrievalQueries,
            strategy: request.strategy,
            threshold: request.threshold ?? 0.6,
            globalRetrievalLimit: request.retrievalLimit ?? 20,
            accessScope: request.accessScope,
            applyAccessScope: false,
            signal: request.signal,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          this.logger.warn(
            `跨知识库 Port 检索失败（knowledge=${knowledgeId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return { chunks: [], trace: [] };
        }
      }),
    );

    const chunks = mergeHybridResults(
      attempts.map((item) => item.chunks),
      request.retrievalLimit ?? 20,
    );
    return {
      chunks,
      trace: attempts.flatMap((item) => item.trace),
      knowledgeCount: knowledgeIds.length,
    };
  }
}
