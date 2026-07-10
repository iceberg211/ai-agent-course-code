import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { normalizeRetrievalStrategy, type RetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import {
  DEFAULT_QUERY_REWRITE_MAX_EXPANSIONS,
} from '@/common/constants';
import { normalizeKeywords, extractFallbackKeywordTerms } from '@/knowledge/utils/keyword.utils';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import type {
  KnowledgeChunk,
  DocumentSearchFilters,
  KnowledgeQueryRewriteResult,
  KnowledgeRetrievalSource,
  NormalizedRetrieveKnowledgeOptions,
  RetrievalDegradedChannel,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
  RetrievalQueryItem,
  KnowledgeHybridRetrievalResult,
  RetrievalStageTrace,
  RerankTraceItem,
} from '@/knowledge/types/knowledge-content.types';
import { QueryRewriteService } from '@/knowledge/services/retrieval/processing/query-rewrite.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { DataScopeService } from '@/rbac/services/data-scope.service';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import { applyJsonbAnyTagFilter } from '@/knowledge/utils/document-filter.util';
import type { RetrievalPort } from '@/knowledge/services/retrieval/pipeline/retrieval-port';
import { RetrievalPipelineService } from '@/knowledge/services/retrieval/pipeline/retrieval-pipeline.service';

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
    stageTrace: {
      queryRewrite: query ? [query] : [],
      channels: {},
      rrfFusion: [],
      rerank: [],
      permissionFilter: {
        before: 0,
        after: 0,
        filtered: 0,
      },
      finalChunks: [],
    },
    degradedChannels: [],
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

interface RerankSelectionResult {
  chunks: KnowledgeChunk[];
  trace: RerankTraceItem[];
  degradedReason?: string;
}

// ==========================================
// KnowledgeSearchService
// ==========================================

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);
  private readonly retrievalPort: RetrievalPort;

  constructor(
    private readonly runtime: RagRuntimeService,
    private readonly hybridRetrieverService: HybridRetrieverService,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
    private readonly dataScopeService: DataScopeService,
    @InjectRepository(Knowledge)
    private readonly knowledgeRepo: Repository<Knowledge>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    /** Search 与 Agent 共用 Port；保留 hybrid 注入仅作兼容，默认走 Port */
    retrievalPipelineService?: RetrievalPipelineService,
  ) {
    this.retrievalPort =
      retrievalPipelineService ??
      ({
        retrieve: async () => ({
          chunks: [],
          trace: [],
          knowledgeCount: 0,
        }),
      } as RetrievalPort);
  }

  async retrieve(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    try {
      const result = await this.retrieveWithDebug(knowledgeId, query, options);
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

  async retrieveWithDebug(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return runInTracedScope(
      {
        name: 'knowledge_retrieve_with_debug',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'single-kb'],
        metadata: { knowledgeId },
        input: {
          knowledgeId,
          query,
          rerank: options.rerank,
          retrievalLimit: options.retrievalLimit,
          rerankLimit: options.rerankLimit,
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
        this.retrieveWithSharedPipeline(query, options, async (params) => {
          const portResult = await this.retrievalPort.retrieve({
            knowledgeId,
            retrievalQueries: params.retrievalQueries,
            strategy: params.strategy,
            threshold: params.options.threshold,
            retrievalLimit: params.options.retrievalLimit,
            accessScope: options.accessScope,
            signal: params.signal,
            graphExpand: params.strategy.useGraph === true,
            question: query,
            currentQuery: params.retrievalQueries[0]?.query,
            profileId: 'search_debug',
          });
          return {
            knowledgeCount: Math.max(portResult.knowledgeCount, 1),
            hybridResult: {
              chunks: portResult.chunks,
              trace: portResult.trace,
            },
          };
        }),
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
          retrievalLimit: options.retrievalLimit,
          rerankLimit: options.rerankLimit,
          threshold: options.threshold,
        },
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
      },
      async () =>
        (
          await this.retrieveForPersonaWithDebugInternal(personaId, query, options)
        ).rerankedChunks,
    );
  }

  async retrieveForPersonaWithDebug(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return runInTracedScope(
      {
        name: 'persona_knowledge_retrieve_with_debug',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'persona', 'debug'],
        metadata: { personaId },
        input: {
          personaId,
          query,
          rerank: options.rerank,
          retrievalLimit: options.retrievalLimit,
          rerankLimit: options.rerankLimit,
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
      () => this.retrieveForPersonaWithDebugInternal(personaId, query, options),
    );
  }

  async retrieveAcrossKnowledgeBasesWithDebug(
    query: string,
    knowledgeBaseIds: string[] = [],
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult & {
    permissionFilteredCount: number;
    channelStats: RetrievalStageTrace['channels'];
  }> {
    const targetIds = await this.resolveKnowledgeSearchScope(knowledgeBaseIds);
    const result = await this.retrieveWithSharedPipeline(query, options, async (params) => {
      if (targetIds.length === 0) {
        return {
          knowledgeCount: 0,
          emptyReason: '没有可检索的知识库',
          hybridResult: { chunks: [], trace: [] },
        };
      }

      const portResult = await this.retrievalPort.retrieve({
        knowledgeIds: targetIds,
        retrievalQueries: params.retrievalQueries,
        strategy: params.strategy,
        threshold: params.options.threshold,
        retrievalLimit: params.options.retrievalLimit,
        accessScope: options.accessScope,
        signal: params.signal,
        graphExpand: params.strategy.useGraph === true,
        question: query,
        currentQuery: params.retrievalQueries[0]?.query,
        profileId: 'search_debug',
      });
      return {
        knowledgeCount: targetIds.length,
        hybridResult: {
          chunks: portResult.chunks,
          trace: portResult.trace,
        },
      };
    });

    const permissionFilteredCount = result.stageTrace?.permissionFilter.filtered ?? 0;
    return {
      ...result,
      permissionFilteredCount,
      channelStats: result.stageTrace?.channels ?? {},
    };
  }

  private async retrieveForPersonaWithDebugInternal(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return this.retrieveWithSharedPipeline(query, options, async (params) => {
      const portResult = await this.retrievalPort.retrieve({
        personaId,
        retrievalQueries: params.retrievalQueries,
        strategy: params.strategy,
        retrievalLimit: params.options.retrievalLimit,
        threshold: params.options.threshold,
        accessScope: options.accessScope,
        signal: params.signal,
        graphExpand: params.strategy.useGraph === true,
        question: query,
        currentQuery: params.retrievalQueries[0]?.query,
        profileId: 'search_debug',
      });

      return {
        knowledgeCount: portResult.knowledgeCount,
        emptyReason: `persona ${personaId} 未挂载知识库`,
        hybridResult: {
          chunks: portResult.chunks,
          trace: portResult.trace,
        },
      };
    });
  }

  private async resolveKnowledgeSearchScope(
    knowledgeBaseIds: string[],
  ): Promise<string[]> {
    const uniqueIds = Array.from(new Set(knowledgeBaseIds.filter(Boolean)));
    if (uniqueIds.length > 0) return uniqueIds;
    const rows = await this.knowledgeRepo.find({
      select: { id: true },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((item) => item.id);
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

    const documentFiltered = await this.filterChunksByDocumentFilters(
      loadResult.hybridResult.chunks,
      options.documentFilters,
    );
    const permissionFiltered = await this.dataScopeService.filterKnowledgeChunks(
      documentFiltered,
      options.accessScope,
    );
    const hybridChunks = permissionFiltered.chunks;
    const rerankStart = Date.now();
    const rerankResult = await this.selectRerankedChunks(
      searchInput.query,
      hybridChunks,
      searchInput.options,
      searchInput.strategy,
      options.signal,
    );
    const rerankLatencyMs = Date.now() - rerankStart;
    const stageTrace = this.buildStageTrace({
      rewrite,
      retrievalTrace: loadResult.hybridResult.trace,
      hybridChunks,
      rerankedChunks: rerankResult.chunks,
      rerankTrace: rerankResult.trace,
      permissionFilter: permissionFiltered.trace,
      rerankLatencyMs,
    });

    return {
      query: searchInput.query,
      retrievalQuery: rewrite.rewrittenQuery,
      retrievalQueries,
      rewrite,
      options: searchInput.options,
      retrievalTrace: loadResult.hybridResult.trace,
      hybridChunks,
      rerankedChunks: rerankResult.chunks,
      stageTrace,
      degradedChannels: this.buildDegradedChannels({
        rewrite,
        stageTrace,
        retrievalTrace: loadResult.hybridResult.trace,
        strategy: searchInput.strategy,
        rerankDegradedReason: rerankResult.degradedReason,
      }),
    };
  }

  private async selectRerankedChunks(
    query: string,
    hybridChunks: KnowledgeChunk[],
    options: NormalizedRetrieveKnowledgeOptions,
    strategy: RetrievalStrategy,
    signal?: AbortSignal,
  ): Promise<RerankSelectionResult> {
    const rerankLimit = strategy.rerankTopK ?? options.rerankLimit ?? 5;
    const minRerankScore = strategy.minRerankScore;
    const fallbackRerankedChunks = hybridChunks.slice(0, rerankLimit);
    if (!options.rerank || hybridChunks.length <= 1) {
      return {
        chunks: fallbackRerankedChunks,
        trace: this.buildRerankTrace(hybridChunks, fallbackRerankedChunks),
      };
    }

    try {
      const chunks = await this.rerankerService.rerank(
        query,
        hybridChunks,
        rerankLimit,
        signal,
        minRerankScore,
      );
      return {
        chunks,
        trace: this.buildRerankTrace(hybridChunks, chunks),
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        chunks: fallbackRerankedChunks,
        trace: this.buildRerankTrace(hybridChunks, fallbackRerankedChunks),
        degradedReason: `Rerank 失败，已使用融合排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private buildDegradedChannels(input: {
    rewrite: KnowledgeQueryRewriteResult;
    stageTrace: RetrievalStageTrace;
    retrievalTrace: KnowledgeHybridRetrievalResult['trace'];
    strategy: RetrievalStrategy;
    rerankDegradedReason?: string;
  }): RetrievalDegradedChannel[] {
    const degraded: RetrievalDegradedChannel[] = [];
    const push = (item: RetrievalDegradedChannel) => {
      if (
        degraded.some(
          (existing) =>
            existing.channel === item.channel && existing.reason === item.reason,
        )
      ) {
        return;
      }
      degraded.push(item);
    };

    if (/失败|超时/.test(input.rewrite.reason)) {
      push({
        channel: 'queryRewrite',
        reason: input.rewrite.reason,
      });
    }

    const expectedChannels: Record<KnowledgeRetrievalSource, boolean> = {
      vector: input.strategy.useVector,
      keyword: input.strategy.useKeyword,
      graph: input.strategy.useGraph,
      memory: Boolean(input.strategy.useMemory),
      multimodal: Boolean(input.strategy.useMultimodal),
    };

    for (const channel of Object.keys(expectedChannels) as KnowledgeRetrievalSource[]) {
      if (!expectedChannels[channel]) continue;
      const trace = input.stageTrace.channels[channel];
      if (!trace || trace.backend === 'disabled' || trace.skipped) {
        push({
          channel,
          reason: '策略要求该通道参与检索，但本次未产生有效召回',
          backend: trace?.backend ?? 'disabled',
        });
        continue;
      }
      if (trace.error) {
        push({
          channel,
          reason: trace.error,
          backend: trace.backend,
        });
      }
    }

    if (input.retrievalTrace.some((item) => item.fallbackToPg)) {
      push({
        channel: 'keyword',
        reason: 'Elasticsearch 不可用或检索失败，已回退 PostgreSQL 全文检索',
        backend: 'pg',
      });
    }

    if (input.rerankDegradedReason) {
      push({
        channel: 'rerank',
        reason: input.rerankDegradedReason,
      });
    }

    return degraded;
  }

  private buildStageTrace(input: {
    rewrite: KnowledgeQueryRewriteResult;
    retrievalTrace: KnowledgeHybridRetrievalResult['trace'];
    hybridChunks: KnowledgeChunk[];
    rerankedChunks: KnowledgeChunk[];
    rerankTrace: RerankTraceItem[];
    permissionFilter: RetrievalStageTrace['permissionFilter'];
    rerankLatencyMs?: number;
  }): RetrievalStageTrace {
    const channels: RetrievalStageTrace['channels'] = {};
    for (const channelName of ['vector', 'keyword', 'graph', 'memory', 'multimodal'] as const) {
      const resultCount = input.retrievalTrace.reduce((count, item) => {
        switch (channelName) {
          case 'vector':
            return count + item.vectorResultCount;
          case 'keyword':
            return count + item.keywordResultCount;
          case 'graph':
            return count + (item.graphResultCount ?? 0);
          case 'memory':
            return count + (item.memoryResultCount ?? 0);
          case 'multimodal':
            return count + (item.multimodalResultCount ?? 0);
        }
      }, 0);
      const backend = this.resolveTraceBackend(input.retrievalTrace, channelName);
      channels[channelName] = {
        enabled: backend !== 'disabled',
        backend,
        resultCount,
        skipped: input.retrievalTrace.every((item) =>
          (item.skippedChannels ?? []).includes(channelName),
        ),
      };
    }

    const rrfFusion = input.retrievalTrace.flatMap((item) => item.rrfFusion ?? []);
    const finalChunks = input.rerankedChunks.map((chunk) => chunk.id);
    return {
      queryRewrite: [
        input.rewrite.originalQuery,
        ...input.rewrite.expandedQueries.map((item) => item.query),
      ].filter((value, index, array) => value && array.indexOf(value) === index),
      channels,
      rrfFusion,
      rerank: input.rerankTrace,
      rerankLatencyMs: input.rerankLatencyMs,
      permissionFilter: input.permissionFilter,
      finalChunks,
    };
  }

  private resolveTraceBackend(
    trace: KnowledgeHybridRetrievalResult['trace'],
    channelName: 'vector' | 'keyword' | 'graph' | 'memory' | 'multimodal',
  ): string | 'disabled' {
    for (const item of trace) {
      const backend =
        channelName === 'vector'
          ? item.vectorBackend
          : channelName === 'keyword'
            ? item.keywordBackend
            : channelName === 'graph'
              ? item.graphBackend
              : channelName === 'memory'
                ? item.memoryBackend
                : item.multimodalBackend;
      if (backend && backend !== 'disabled') {
        return backend;
      }
    }
    return 'disabled';
  }

  private buildRerankTrace(
    beforeChunks: KnowledgeChunk[],
    afterChunks: KnowledgeChunk[],
  ): RerankTraceItem[] {
    const beforeRank = new Map<string, number>();
    beforeChunks.forEach((chunk, index) => beforeRank.set(chunk.id, index + 1));
    return afterChunks.map((chunk, index) => ({
      chunkId: chunk.id,
      beforeRank: beforeRank.get(chunk.id) ?? -1,
      afterRank: index + 1,
      rerankScore: chunk.rerank_score ?? null,
    }));
  }

  private async filterChunksByDocumentFilters(
    chunks: KnowledgeChunk[],
    filters?: DocumentSearchFilters,
  ): Promise<KnowledgeChunk[]> {
    if (!this.hasDocumentFilters(filters) || chunks.length === 0) {
      return chunks;
    }

    const ids = chunks.map((chunk) => chunk.id).filter(Boolean);
    if (ids.length === 0) return chunks;

    const qb = this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin('chunk.document', 'document')
      .select('chunk.id', 'id')
      .where('chunk.id IN (:...ids)', { ids })
      .andWhere('chunk.enabled = true')
      .andWhere('document.is_current_version = true')
      .andWhere('document.archived_at IS NULL');

    const fileTypes = this.resolveFileTypeFilters(filters?.fileType);
    if (fileTypes.length > 0) {
      qb.andWhere(
        new Brackets((where) => {
          fileTypes.forEach((item, index) => {
            const extKey = `fileExt${index}`;
            const mimeKey = `fileMime${index}`;
            const clause =
              `(LOWER(document.filename) LIKE :${extKey} OR LOWER(COALESCE(document.mime_type, '')) LIKE :${mimeKey})`;
            if (index === 0) {
              where.where(clause, {
                [extKey]: `%.${item.ext}`,
                [mimeKey]: `${item.mime}%`,
              });
              return;
            }
            where.orWhere(clause, {
              [extKey]: `%.${item.ext}`,
              [mimeKey]: `${item.mime}%`,
            });
          });
        }),
      );
    }

    const tags = (filters?.tags ?? [])
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length > 0) {
      applyJsonbAnyTagFilter(qb, 'document', tags);
    }

    const department = filters?.department?.trim();
    if (department) {
      qb.andWhere('document.department = :department', { department });
    }

    const businessCategory = filters?.businessCategory?.trim();
    if (businessCategory) {
      qb.andWhere('document.business_category = :businessCategory', {
        businessCategory,
      });
    }

    if (filters?.visibility) {
      qb.andWhere('document.visibility = :visibility', {
        visibility: filters.visibility,
      });
    }

    const rows = await qb.getRawMany<{ id: string }>();
    const allowedIds = new Set(rows.map((row) => row.id));
    return chunks.filter((chunk) => allowedIds.has(chunk.id));
  }

  private hasDocumentFilters(
    filters?: DocumentSearchFilters,
  ): filters is DocumentSearchFilters {
    if (!filters) return false;
    return Boolean(
      filters.fileType?.trim() ||
        filters.tags?.some((tag) => tag.trim()) ||
        filters.department?.trim() ||
        filters.businessCategory?.trim() ||
        filters.visibility,
    );
  }

  private resolveFileTypeFilters(
    raw?: string,
  ): Array<{ ext: string; mime: string }> {
    const value = raw?.trim().toLowerCase();
    if (!value) return [];
    const groups: Record<string, Array<{ ext: string; mime: string }>> = {
      image: [
        { ext: 'jpg', mime: 'image/' },
        { ext: 'jpeg', mime: 'image/' },
        { ext: 'png', mime: 'image/' },
        { ext: 'webp', mime: 'image/' },
        { ext: 'gif', mime: 'image/' },
      ],
      audio: [
        { ext: 'mp3', mime: 'audio/' },
        { ext: 'wav', mime: 'audio/' },
        { ext: 'm4a', mime: 'audio/' },
        { ext: 'aac', mime: 'audio/' },
        { ext: 'ogg', mime: 'audio/' },
      ],
      video: [
        { ext: 'mp4', mime: 'video/' },
        { ext: 'mov', mime: 'video/' },
        { ext: 'mkv', mime: 'video/' },
        { ext: 'webm', mime: 'video/' },
      ],
    };
    if (groups[value]) return groups[value];
    const ext = value.replace(/^\./, '');
    return [{ ext, mime: `${ext}/` }];
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
