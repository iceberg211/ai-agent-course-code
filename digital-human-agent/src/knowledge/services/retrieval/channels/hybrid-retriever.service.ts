import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  isAbortError,
  isTransientInfrastructureError,
  mapWithConcurrency,
  throwIfAborted,
} from '@/common/utils';
import {
  normalizeRetrievalStrategy,
  type RetrievalStrategy,
} from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import {
  DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG,
  HYBRID_PER_QUERY_MIN_TOP_K,
  HYBRID_MULTI_QUERY_CONCURRENCY,
} from '@/common/constants';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
import {
  fuseHybridAndGraphChannels,
  mergeHybridResults,
  fuseVectorAndKeywordResults,
  fuseMultiChannelResultsWithTrace,
} from '@/knowledge/services/retrieval/channels/knowledge-retrieval-fusion';
import { PersonaKbConfigService } from '@/knowledge/services/manage/persona-kb-config.service';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import { FulltextRetrieverService } from './fulltext-retriever.service';
import type {
  GraphBackend,
  KeywordBackend,
  KnowledgeChunk,
  MountedKnowledgeConfig,
  RetrieveKnowledgeTraceItem,
  KnowledgeHybridRetrievalParams,
  KnowledgeHybridRetrievalResult,
  KnowledgeAccessScope,
  PersonaHybridRetrievalInput,
  PersonaHybridRetrievalResult,
  RrfTraceItem,
} from '@/knowledge/types/knowledge-content.types';

interface HybridRetrieveResult {
  chunks: KnowledgeChunk[];
  keywordBackend: KeywordBackend | 'disabled';
  vectorResultCount: number;
  keywordResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'graph'>;
  rrfFusionTrace: RrfTraceItem[];
}

interface KeywordRetrieveResult {
  chunks: KnowledgeChunk[];
  backend: KeywordBackend;
  fallbackToPg: boolean;
}

interface PersonaKnowledgeRetrievalAttempt {
  knowledgeId: string;
  failed: boolean;
  errorMessage?: string;
  result: KnowledgeHybridRetrievalResult;
}

@Injectable()
export class HybridRetrieverService {
  private readonly logger = new Logger(HybridRetrieverService.name);

  constructor(
    private readonly runtime: RagRuntimeService,
    private readonly configService: ConfigService,
    private readonly fulltextRetriever: FulltextRetrieverService,
    @Optional()
    private readonly graphRetriever?: KnowledgeGraphService,
    @Optional()
    private readonly personaKnowledgeConfigService?: PersonaKbConfigService,
    @Optional()
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo?: Repository<KnowledgeChunkEntity>,
  ) {}

  // ==========================================
  // 单知识库第一阶段多路召回
  // ==========================================
  async retrieveForKnowledge(
    params: KnowledgeHybridRetrievalParams,
  ): Promise<KnowledgeHybridRetrievalResult> {
    const perQueryTopK = Math.max(
      HYBRID_PER_QUERY_MIN_TOP_K,
      Math.ceil(
        params.globalRetrievalLimit /
          Math.max(params.retrievalQueries.length, 1),
      ),
    );
    const taskResults = await mapWithConcurrency(
      params.retrievalQueries,
      HYBRID_MULTI_QUERY_CONCURRENCY,
      async (retrievalQuery) => {
        try {
          throwIfAborted(params.signal);
          let queryEmbedding: number[] | undefined;
          if (params.strategy.useVector) {
            try {
              queryEmbedding = await this.runtime.withTransientRetry(
                'embed query',
                () => {
                  throwIfAborted(params.signal);
                  return this.runtime.embeddings.embedQuery(retrievalQuery.query);
                },
                3,
              );
            } catch (error) {
              if (isAbortError(error)) {
                throw error;
              }
              this.logger.warn(
                `query embedding 失败，跳过向量通道：${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }

          throwIfAborted(params.signal);

          const hybridResult = await this.retrieveHybridChannels({
            knowledgeId: params.knowledgeId,
            queryEmbedding,
            retrievalQuery: retrievalQuery.query,
            keywordTerms: retrievalQuery.keywords,
            threshold: params.threshold,
            matchCount: perQueryTopK,
            strategy: params.strategy,
            accessScope: params.accessScope,
            signal: params.signal,
          });

          const keywordBackend: KeywordBackend | undefined =
            hybridResult.keywordBackend === 'disabled'
              ? undefined
              : hybridResult.keywordBackend;

          const chunks = hybridResult.chunks.map((chunk) => ({
            ...chunk,
            matched_queries: Array.from(
              new Set([...(chunk.matched_queries ?? []), retrievalQuery.index]),
            ),
            keyword_backend: keywordBackend ?? chunk.keyword_backend,
            vector_backend: this.resolveChunkVectorBackend(chunk),
          }));

          const traceItem: RetrieveKnowledgeTraceItem = {
            knowledgeId: params.knowledgeId,
            queryIndex: retrievalQuery.index,
            query: retrievalQuery.query,
            keywords: retrievalQuery.keywords,
            angle: retrievalQuery.angle,
            vectorBackend: params.strategy.useVector ? 'pgvector' : 'disabled',
            keywordBackend: params.strategy.useKeyword
              ? hybridResult.keywordBackend
              : 'disabled',
            vectorResultCount: hybridResult.vectorResultCount,
            keywordResultCount: hybridResult.keywordResultCount,
            graphBackend: hybridResult.graphBackend,
            graphResultCount: hybridResult.graphResultCount,
            mergedResultCount: chunks.length,
            fallbackToPg: hybridResult.fallbackToPg,
            skippedChannels: hybridResult.skippedChannels as any[],
            rrfFusion: hybridResult.rrfFusionTrace,
            finalChunks: chunks.map((chunk) => chunk.id),
            avgVectorScore: chunks.length > 0
              ? chunks.reduce((acc, c) => acc + (c.similarity ?? 0), 0) / chunks.length
              : 0,
            avgKeywordScore: chunks.length > 0
              ? chunks.reduce((acc, c) => acc + (c.keyword_score ?? 0), 0) / chunks.length
              : 0,
            avgGraphScore: chunks.length > 0
              ? chunks.reduce((acc, c) => acc + (c.graph_score ?? 0), 0) / chunks.length
              : 0,
          };

          return { chunks, traceItem };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          if (isTransientInfrastructureError(error)) {
            throw error;
          }

          this.logger.error(
            `子查询检索失败（query=${retrievalQuery.query}）：${
              error instanceof Error ? error.stack ?? error.message : String(error)
            }`,
          );

          // 容错返回空结果，避免单个子查询挂掉拖垮整体 RAG
          return {
            chunks: [],
            traceItem: {
              knowledgeId: params.knowledgeId,
              queryIndex: retrievalQuery.index,
              query: retrievalQuery.query,
              keywords: retrievalQuery.keywords,
              angle: retrievalQuery.angle,
              vectorBackend: 'disabled',
              keywordBackend: 'disabled',
              vectorResultCount: 0,
              keywordResultCount: 0,
              graphBackend: 'disabled',
              graphResultCount: 0,
              mergedResultCount: 0,
              fallbackToPg: false,
              skippedChannels: ['vector', 'keyword', 'graph'],
              rrfFusion: [],
              finalChunks: [],
            } as RetrieveKnowledgeTraceItem,
          };
        }
      },
    );
    const results = taskResults.map((t) => t.chunks);
    const trace = taskResults.map((t) => t.traceItem);

    return {
      chunks: mergeHybridResults(results, params.globalRetrievalLimit),
      trace,
    };
  }

  // ==========================================
  // 多知识库（Persona）第一阶段召回
  // ==========================================
  async retrieveForPersona(
    input: PersonaHybridRetrievalInput,
  ): Promise<PersonaHybridRetrievalResult> {
    throwIfAborted(input.signal);

    if (input.retrievalQueries.length === 0) {
      return {
        knowledgeCount: 0,
        chunks: [],
        trace: [],
      };
    }

    const knowledgeConfigs = await this.listMountedKnowledgeConfigs(
      input.personaId,
    );
    throwIfAborted(input.signal);

    if (knowledgeConfigs.length === 0) {
      return {
        knowledgeCount: 0,
        chunks: [],
        trace: [],
      };
    }

    const strategy = this.buildPersonaStrategy(input);
    const attempts = await mapWithConcurrency(
      knowledgeConfigs,
      this.resolvePersonaConcurrency(),
      async (config): Promise<PersonaKnowledgeRetrievalAttempt> => {
        try {
          throwIfAborted(input.signal);
          const result = await this.retrieveForKnowledge({
            knowledgeId: config.knowledgeId,
            retrievalQueries: input.retrievalQueries,
            strategy,
            threshold: this.resolveThreshold(input.threshold, config),
            accessScope: input.accessScope,
            globalRetrievalLimit: this.resolveRetrievalLimit(
              input.retrievalLimit,
              config,
            ),
            signal: input.signal,
          });
          return {
            knowledgeId: config.knowledgeId,
            failed: false,
            result,
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          if (isTransientInfrastructureError(error)) {
            throw error;
          }

          this.logger.warn(
            `persona 检索失败（knowledge=${config.knowledgeId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            knowledgeId: config.knowledgeId,
            failed: true,
            errorMessage:
              error instanceof Error ? error.message : String(error),
            result: {
              chunks: [],
              trace: [],
            },
          };
        }
      },
    );
    const successfulResults = attempts.filter((item) => !item.failed);
    const failedResults = attempts.filter((item) => item.failed);

    if (successfulResults.length === 0 && failedResults.length > 0) {
      const failedKnowledgeIds = failedResults
        .map((item) => item.knowledgeId)
        .join(', ');
      throw new Error(
        `persona ${input.personaId} 的知识库检索全部失败：${failedKnowledgeIds}`,
      );
    }

    if (failedResults.length > 0) {
      this.logger.warn(
        `persona ${input.personaId} 有 ${failedResults.length} 个知识库检索失败，继续返回其余结果`,
      );
    }

    const rerankLimits = knowledgeConfigs.map(
      (c) =>
        c.retrievalConfig?.rerankLimit ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
    );
    const rerankLimit =
      rerankLimits.length > 0
        ? Math.max(...rerankLimits)
        : DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit;

    return {
      knowledgeCount: successfulResults.length,
      chunks: mergeHybridResults(
        successfulResults.map((item) => item.result.chunks),
        input.retrievalLimit === undefined
          ? Math.max(
              20,
              ...knowledgeConfigs.map((config) => config.retrievalLimit),
            )
          : this.runtime.toBoundedNumber(input.retrievalLimit, 20, 1, 50),
      ),
      trace: successfulResults.flatMap((item) => item.result.trace),
      rerankLimit,
    };
  }

  // ==========================================
  // 混合召回与图谱融合核心
  // ==========================================
  private async retrieveHybridChannels(params: {
    knowledgeId: string;
    queryEmbedding: number[] | undefined;
    retrievalQuery: string;
    keywordTerms: string[];
    threshold: number;
    matchCount: number;
    strategy: RetrievalStrategy;
    signal?: AbortSignal;
    accessScope?: KnowledgeAccessScope;
  }): Promise<
    HybridRetrieveResult & {
      graphBackend: GraphBackend | 'disabled';
      graphResultCount: number;
    }
  > {
    const hybridPromise =
      params.strategy.useVector || params.strategy.useKeyword
        ? this.hybridRetrieve({
            knowledgeId: params.knowledgeId,
            queryEmbedding: params.queryEmbedding,
            retrievalQuery: params.retrievalQuery,
            keywordTerms: params.keywordTerms,
            threshold: params.threshold,
            matchCount: params.matchCount,
            strategy: params.strategy,
            signal: params.signal,
            accessScope: params.accessScope,
          })
        : Promise.resolve(this.buildSkippedHybridResult(params.strategy));

    const graphPromise = this.retrieveGraphChunks(
      params.knowledgeId,
      params.retrievalQuery,
      params.keywordTerms,
      params.matchCount,
      params.strategy,
      params.signal,
      params.accessScope,
    );

    const [hybridResult, graphChunks] = await Promise.all([
      hybridPromise,
      graphPromise,
    ]);

    const skippedChannels = new Set(hybridResult.skippedChannels);
    const graphBackend = this.isGraphRetrieverEnabled(params.strategy)
      ? 'neo4j'
      : 'disabled';
    if (graphBackend === 'disabled') {
      skippedChannels.add('graph');
    }
    const channels = new Map<string, KnowledgeChunk[]>();
    for (const channelName of ['vector', 'keyword', 'graph', 'memory', 'multimodal']) {
      const chunks = hybridResult.chunks.filter((chunk) =>
        chunk.retrieval_sources?.includes(channelName as any) ||
        chunk.channel_rank?.[channelName as any] !== undefined ||
        chunk.raw_score?.[channelName as any] !== undefined,
      );
      if (chunks.length > 0) channels.set(channelName, chunks);
    }
    if (graphChunks.length > 0) channels.set('graph', graphChunks);
    const fused = fuseMultiChannelResultsWithTrace(channels, {
      globalRetrievalLimit: params.matchCount,
      rrfK: params.strategy.rrfK,
    });

    return {
      ...hybridResult,
      chunks: fused.chunks,
      rrfFusionTrace: fused.trace,
      graphBackend,
      graphResultCount: graphChunks.length,
      skippedChannels: Array.from(skippedChannels),
    };
  }

  // ==========================================
  // Vector & Keyword 并行召回与 RRF 混合
  // ==========================================
  private async hybridRetrieve(params: {
    knowledgeId: string;
    queryEmbedding?: number[];
    retrievalQuery: string;
    keywordTerms: string[];
    threshold: number;
    matchCount: number;
    strategy: RetrievalStrategy;
    signal?: AbortSignal;
    accessScope?: KnowledgeAccessScope;
  }): Promise<HybridRetrieveResult> {
    const useVector = params.strategy.useVector !== false;
    const useKeyword = params.strategy.useKeyword !== false;
    const useExactPhrase = params.strategy.useExactPhrase === true;
    const skippedChannels: Array<'vector' | 'keyword'> = [];

    const vectorTopK = params.strategy.vectorTopK ?? params.matchCount;
    const keywordTopK = params.strategy.keywordTopK ?? params.matchCount;

    return runInTracedScope(
      {
        name: 'knowledge_hybrid_retrieve',
        runType: 'retriever',
        tags: ['knowledge', 'rag', 'retrieve', 'hybrid'],
        metadata: {
          knowledgeId: params.knowledgeId,
          threshold: params.threshold,
          matchCount: params.matchCount,
          keywordTermCount: params.keywordTerms.length,
          useVector,
          useKeyword,
          useExactPhrase,
        },
        input: {
          knowledgeId: params.knowledgeId,
          retrievalQuery: params.retrievalQuery,
          keywordTerms: params.keywordTerms,
        },
        outputProcessor: (output) => ({
          resultCount: output.chunks.length,
          keywordBackend: output.keywordBackend,
          vectorResultCount: output.vectorResultCount,
          keywordResultCount: output.keywordResultCount,
          fallbackToPg: output.fallbackToPg,
          skippedChannels: output.skippedChannels,
        }),
      },
      async () => {
        const vectorPromise =
          useVector && params.queryEmbedding
            ? this.vectorRetrieve({
                knowledgeId: params.knowledgeId,
                queryEmbedding: params.queryEmbedding,
                threshold: params.threshold,
                matchCount: vectorTopK,
                signal: params.signal,
                accessScope: params.accessScope,
              })
            : Promise.resolve([] as KnowledgeChunk[]);
        if (!useVector || !params.queryEmbedding) {
          skippedChannels.push('vector');
        }

        const keywordPromise = useKeyword
          ? this.keywordRetrieve({
              knowledgeId: params.knowledgeId,
              terms: params.keywordTerms,
              matchCount: keywordTopK,
              useExactPhrase: useExactPhrase,
              signal: params.signal,
              accessScope: params.accessScope,
            })
          : Promise.resolve({
              chunks: [] as KnowledgeChunk[],
              backend: 'pg' as const,
              fallbackToPg: false,
            });
        if (!useKeyword) {
          skippedChannels.push('keyword');
        }

        const [vectorSettled, keywordSettled] = await Promise.allSettled([
          vectorPromise,
          keywordPromise,
        ]);
        let vectorResults: KnowledgeChunk[] = [];
        let keywordResult: KeywordRetrieveResult | null = null;

        if (vectorSettled.status === 'fulfilled') {
          vectorResults = vectorSettled.value;
        } else if (isAbortError(vectorSettled.reason)) {
          throw vectorSettled.reason;
        } else {
          skippedChannels.push('vector');
          this.logger.warn(
            `向量检索失败，继续使用其他通道：${
              vectorSettled.reason instanceof Error
                ? vectorSettled.reason.message
                : String(vectorSettled.reason)
            }`,
          );
        }

        if (keywordSettled.status === 'fulfilled') {
          keywordResult = keywordSettled.value;
        } else if (isAbortError(keywordSettled.reason)) {
          throw keywordSettled.reason;
        } else {
          skippedChannels.push('keyword');
          this.logger.warn(
            `关键词检索失败，继续使用其他通道：${
              keywordSettled.reason instanceof Error
                ? keywordSettled.reason.message
                : String(keywordSettled.reason)
            }`,
          );
        }

        const keywordChunks = keywordResult?.chunks ?? [];

        const channels = new Map<string, KnowledgeChunk[]>();
        channels.set('vector', vectorResults);
        channels.set('keyword', keywordChunks);
        const fused = fuseMultiChannelResultsWithTrace(channels, {
          globalRetrievalLimit: params.matchCount,
          rrfK: params.strategy.rrfK,
        });

        return {
          chunks: fused.chunks,
          keywordBackend:
            useKeyword && keywordResult ? keywordResult.backend : 'disabled',
          vectorResultCount: vectorResults.length,
          keywordResultCount: keywordChunks.length,
          fallbackToPg: keywordResult?.fallbackToPg ?? false,
          skippedChannels: Array.from(new Set(skippedChannels)),
          rrfFusionTrace: fused.trace,
        };
      },
    );
  }

  private async vectorRetrieve(params: {
    knowledgeId: string;
    queryEmbedding: number[];
    threshold: number;
    matchCount: number;
    signal?: AbortSignal;
    accessScope?: KnowledgeAccessScope;
  }): Promise<KnowledgeChunk[]> {
    return runInTracedScope(
      {
        name: 'knowledge_vector_retrieve',
        runType: 'retriever',
        tags: ['knowledge', 'rag', 'retrieve', 'vector'],
        metadata: {
          knowledgeId: params.knowledgeId,
          threshold: params.threshold,
          matchCount: params.matchCount,
        },
        outputProcessor: (output) => ({ resultCount: output.length }),
      },
      async () => {
        throwIfAborted(params.signal);
        const { data, error } = await this.runtime.withTransientRetry<{
          data: KnowledgeChunk[] | null;
          error: { message: string } | null;
        }>(
          'match_knowledge rpc',
          async () => {
            throwIfAborted(params.signal);
            const query = this.runtime.supabase.rpc('match_knowledge', {
              query_embedding: params.queryEmbedding,
              p_kb_id: params.knowledgeId,
              match_threshold: params.threshold,
              match_count: params.matchCount,
              p_user_id: params.accessScope?.ownerId || null,
              p_department: params.accessScope?.department || null,
              p_role: params.accessScope?.role || null,
              p_is_admin: params.accessScope?.role === 'admin',
            });
            const result = params.signal
              ? await query.abortSignal(params.signal)
              : await query;
            return {
              data: (result.data as KnowledgeChunk[] | null) ?? null,
              error: result.error ? { message: result.error.message } : null,
            };
          },
          3,
        );
        throwIfAborted(params.signal);
        if (error) throw new Error(error.message);
        const chunks = (data ?? []).map((chunk) => ({
          ...chunk,
          retrieval_sources: ['vector' as const],
        }));
        return this.filterCurrentChunks(
          params.knowledgeId,
          chunks,
          params.accessScope,
        );
      },
    );
  }

  private async keywordRetrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    useExactPhrase?: boolean;
    signal?: AbortSignal;
    accessScope?: KnowledgeAccessScope;
  }): Promise<KeywordRetrieveResult> {
    return this.fulltextRetriever.retrieve(params);
  }

  private async retrieveGraphChunks(
    knowledgeId: string,
    retrievalQuery: string,
    keywordTerms: string[],
    matchCount: number,
    strategy: RetrievalStrategy,
    signal?: AbortSignal,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeChunk[]> {
    const graphRetriever = this.graphRetriever;
    if (!this.isGraphRetrieverEnabled(strategy) || !graphRetriever) return [];

    try {
      const chunks = await graphRetriever.retrieve({
        knowledgeId,
        retrievalQuery,
        keywordTerms,
        matchCount,
        graphMaxHops: strategy.graphMaxHops,
        graphMode: strategy.graphMode,
        accessScope,
        signal,
      });
      return this.filterCurrentChunks(knowledgeId, chunks, accessScope);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `Neo4j GraphRetriever 失败，继续使用其他检索通道：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private isGraphRetrieverEnabled(strategy: RetrievalStrategy): boolean {
    return (
      strategy.useGraph === true &&
      this.graphRetriever !== undefined &&
      this.graphRetriever.isEnabled()
    );
  }

  private resolveChunkVectorBackend(
    chunk: KnowledgeChunk,
  ): KnowledgeChunk['vector_backend'] {
    if (chunk.vector_backend) {
      return chunk.vector_backend;
    }

    const sources = chunk.retrieval_sources ?? [];
    if (sources.includes('vector')) {
      return 'pgvector';
    }

    return undefined;
  }

  private buildPersonaStrategy(
    input: PersonaHybridRetrievalInput,
  ): RetrievalStrategy {
    if (input.strategy) {
      return normalizeRetrievalStrategy({
        ...input.strategy,
        queryCount: input.retrievalQueries.length,
      });
    }

    const channels = input.channels;
    if (!channels) {
      throw new Error('persona 检索缺少 strategy 或 channels 配置');
    }

    return normalizeRetrievalStrategy({
      needRetrieval: true,
      useVector: channels.useVector,
      useKeyword: channels.useKeyword,
      useGraph: channels.useGraph,
      useExactPhrase: channels.useExactPhrase ?? false,
      useMultiQuery: input.retrievalQueries.length > 1,
      allowWeb: false,
      queryCount: input.retrievalQueries.length,
      chunkContextWindow: 0,
      reason: 'persona 检索',
    });
  }

  private async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<MountedKnowledgeConfig[]> {
    if (!this.personaKnowledgeConfigService) {
      throw new Error(
        '缺少 PersonaKbConfigService，无法执行 persona 检索',
      );
    }
    return this.personaKnowledgeConfigService.listMountedKnowledgeConfigs(
      personaId,
    );
  }

  private resolveThreshold(
    threshold: number | undefined,
    config: MountedKnowledgeConfig,
  ): number {
    return threshold === undefined
      ? config.threshold
      : this.runtime.toBoundedNumber(threshold, config.threshold, 0, 1);
  }

  private resolveRetrievalLimit(
    retrievalLimit: number | undefined,
    config: MountedKnowledgeConfig,
  ): number {
    return retrievalLimit === undefined
      ? config.retrievalLimit
      : this.runtime.toBoundedNumber(
          retrievalLimit,
          config.retrievalLimit,
          1,
          50,
        );
  }

  private resolvePersonaConcurrency(): number {
    return this.runtime.toBoundedNumber(
      this.configService.get<string>('RAG_PERSONA_KB_CONCURRENCY'),
      3,
      1,
      8,
    );
  }

  private async filterCurrentChunks(
    knowledgeId: string,
    chunks: KnowledgeChunk[],
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeChunk[]> {
    if (!this.chunkRepo || chunks.length === 0) return chunks;
    const rows = await this.chunkRepo.find({
      where: {
        id: In(chunks.map((chunk) => chunk.id)),
        enabled: true,
        document: {
          knowledgeBaseId: knowledgeId,
          isCurrentVersion: true,
          archivedAt: IsNull(),
        },
      },
      relations: { document: true },
    });
    if (accessScope?.role !== 'admin') {
      const ownerId = accessScope?.ownerId ?? '';
      const department = accessScope?.department ?? '';
      rows.splice(
        0,
        rows.length,
        ...rows.filter((row) => {
          const document = row.document;
          if (document.visibility === 'company') return true;
          if (document.visibility === 'department') {
            return Boolean(department && document.department === department);
          }
          return Boolean(ownerId && document.ownerId === ownerId);
        }),
      );
    }
    const allowed = new Set(rows.map((row) => row.id));
    return chunks.filter((chunk) => allowed.has(chunk.id));
  }

  private buildSkippedHybridResult(
    strategy: RetrievalStrategy,
  ): HybridRetrieveResult {
    const skippedChannels = new Set<'vector' | 'keyword' | 'graph'>();
    if (!strategy.useVector) {
      skippedChannels.add('vector');
    }
    if (!strategy.useKeyword) skippedChannels.add('keyword');

    return {
      chunks: [],
      keywordBackend: 'disabled',
      vectorResultCount: 0,
      keywordResultCount: 0,
      fallbackToPg: false,
      skippedChannels: Array.from(skippedChannels),
      rrfFusionTrace: [],
    };
  }
}
