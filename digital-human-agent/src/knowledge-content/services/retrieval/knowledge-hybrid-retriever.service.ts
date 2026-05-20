import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  isAbortError,
  isTransientInfrastructureError,
  throwIfAborted,
} from '@/common/utils';
import type { RetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { KnowledgeGraphService } from '@/knowledge-content/graph/knowledge-graph.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/manage/knowledge-content-runtime.service';
import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/retrieval/knowledge-keyword-retriever.service';
import {
  fuseStage1Channels,
  mergeStage1Results,
} from '@/knowledge-content/services/retrieval/knowledge-retrieval-fusion';
import { PersonaKnowledgeConfigService } from '@/knowledge-content/services/manage/persona-knowledge-config.service';
import type {
  GraphBackend,
  KeywordBackend,
  KnowledgeChunk,
  MountedKnowledgeConfig,
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
  KnowledgeRetrievalSource,
  KnowledgeHybridRetrievalParams,
  KnowledgeHybridRetrievalResult,
  PersonaHybridRetrievalChannels,
  PersonaHybridRetrievalInput,
  PersonaHybridRetrievalResult,
} from '@/knowledge-content/types/knowledge-content.types';

interface HybridRetrieveResult {
  chunks: KnowledgeChunk[];
  keywordBackend: KeywordBackend | 'disabled';
  vectorResultCount: number;
  keywordResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'graph'>;
}

const RRF_K = 60;

// ==========================================
// 辅助并发限制工具
// ==========================================

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeHybridRetrieverService {
  private readonly logger = new Logger(KnowledgeHybridRetrieverService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly keywordRetriever: KnowledgeKeywordRetrieverService,
    @Optional()
    private readonly graphRetriever?: KnowledgeGraphService,
    @Optional()
    private readonly personaKnowledgeConfigService?: PersonaKnowledgeConfigService,
  ) {}

  // ==========================================
  // 单知识库第一阶段多路召回
  // ==========================================
  async retrieveForKnowledge(
    params: KnowledgeHybridRetrievalParams,
  ): Promise<KnowledgeHybridRetrievalResult> {
    const perQueryTopK = Math.max(
      4,
      Math.ceil(
        params.globalStage1TopK / Math.max(params.retrievalQueries.length, 1),
      ),
    );
    const results: KnowledgeChunk[][] = [];
    const trace: RetrieveKnowledgeTraceItem[] = [];

    for (const retrievalQuery of params.retrievalQueries) {
      throwIfAborted(params.signal);
      const queryEmbedding = params.strategy.useVector
        ? await this.runtime.withTransientRetry(
            'embed query',
            () => {
              throwIfAborted(params.signal);
              return this.runtime.embeddings.embedQuery(retrievalQuery.query);
            },
            3,
          )
        : undefined;

      const stage1Result = await this.retrieveStage1({
        knowledgeId: params.knowledgeId,
        queryEmbedding,
        retrievalQuery: retrievalQuery.query,
        keywordTerms: retrievalQuery.keywords,
        threshold: params.threshold,
        matchCount: perQueryTopK,
        strategy: params.strategy,
        signal: params.signal,
      });

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
        knowledgeId: params.knowledgeId,
        queryIndex: retrievalQuery.index,
        query: retrievalQuery.query,
        keywords: retrievalQuery.keywords,
        angle: retrievalQuery.angle,
        vectorBackend: params.strategy.useVector ? 'pgvector' : 'disabled',
        keywordBackend: params.strategy.useKeyword
          ? stage1Result.keywordBackend
          : 'disabled',
        vectorResultCount: stage1Result.vectorResultCount,
        keywordResultCount: stage1Result.keywordResultCount,
        graphBackend: stage1Result.graphBackend,
        graphResultCount: stage1Result.graphResultCount,
        mergedResultCount: chunks.length,
        fallbackToPg: stage1Result.fallbackToPg,
        skippedChannels: stage1Result.skippedChannels,
      });
    }

    return {
      chunks: mergeStage1Results(results, params.globalStage1TopK),
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
    const stage1Results = await mapWithConcurrency(
      knowledgeConfigs,
      this.resolvePersonaConcurrency(),
      async (config) => {
        try {
          throwIfAborted(input.signal);
          return await this.retrieveForKnowledge({
            knowledgeId: config.knowledgeId,
            retrievalQueries: input.retrievalQueries,
            strategy,
            threshold: this.resolveThreshold(input.threshold, config),
            globalStage1TopK: this.resolveStage1TopK(input.stage1TopK, config),
            signal: input.signal,
          });
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          if (isTransientInfrastructureError(error)) {
            throw error;
          }

          this.logger.warn(
            `persona stage1 失败（knowledge=${config.knowledgeId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            chunks: [],
            trace: [],
          } satisfies KnowledgeHybridRetrievalResult;
        }
      },
    );

    return {
      knowledgeCount: knowledgeConfigs.length,
      chunks: mergeStage1Results(
        stage1Results.map((result) => result.chunks),
        input.stage1TopK === undefined
          ? Math.max(20, ...knowledgeConfigs.map((config) => config.stage1TopK))
          : this.runtime.toBoundedNumber(input.stage1TopK, 20, 1, 50),
      ),
      trace: stage1Results.flatMap((result) => result.trace),
    };
  }

  // ==========================================
  // 混合召回与图谱融合核心
  // ==========================================
  private async retrieveStage1(params: {
    knowledgeId: string;
    queryEmbedding: number[] | undefined;
    retrievalQuery: string;
    keywordTerms: string[];
    threshold: number;
    matchCount: number;
    strategy: RetrievalStrategy;
    signal?: AbortSignal;
  }): Promise<
    HybridRetrieveResult & {
      graphBackend: GraphBackend | 'disabled';
      graphResultCount: number;
    }
  > {
    const hybridResult =
      params.strategy.useVector || params.strategy.useKeyword
        ? await this.hybridRetrieve({
            knowledgeId: params.knowledgeId,
            queryEmbedding: params.queryEmbedding,
            retrievalQuery: params.retrievalQuery,
            keywordTerms: params.keywordTerms,
            threshold: params.threshold,
            matchCount: params.matchCount,
            useVector: params.strategy.useVector,
            useKeyword: params.strategy.useKeyword,
            useExactPhrase: params.strategy.useExactPhrase,
            signal: params.signal,
          })
        : this.buildSkippedHybridResult(params.strategy);

    const graphChunks = await this.retrieveGraphChunks(
      params.knowledgeId,
      params.retrievalQuery,
      params.keywordTerms,
      params.matchCount,
      params.strategy,
      params.signal,
    );

    const skippedChannels = new Set(hybridResult.skippedChannels);
    const graphBackend = this.isGraphRetrieverEnabled(params.strategy)
      ? 'neo4j'
      : 'disabled';
    if (graphBackend === 'disabled') {
      skippedChannels.add('graph');
    }

    return {
      ...hybridResult,
      chunks: fuseStage1Channels(
        hybridResult.chunks,
        graphChunks,
        params.matchCount,
      ),
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
    useVector?: boolean;
    useKeyword?: boolean;
    useExactPhrase?: boolean;
    signal?: AbortSignal;
  }): Promise<HybridRetrieveResult> {
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
          useVector: params.useVector !== false,
          useKeyword: params.useKeyword !== false,
          useExactPhrase: params.useExactPhrase === true,
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
        const useVector = params.useVector !== false;
        const useKeyword = params.useKeyword !== false;
        const skippedChannels: Array<'vector' | 'keyword'> = [];

        const vectorPromise =
          useVector && params.queryEmbedding
            ? this.vectorRetrieve({
                knowledgeId: params.knowledgeId,
                queryEmbedding: params.queryEmbedding,
                threshold: params.threshold,
                matchCount: params.matchCount,
                signal: params.signal,
              })
            : Promise.resolve([] as KnowledgeChunk[]);
        if (!useVector || !params.queryEmbedding) {
          skippedChannels.push('vector');
        }

        const keywordPromise = useKeyword
          ? this.keywordRetriever.retrieve({
              knowledgeId: params.knowledgeId,
              terms: params.keywordTerms,
              matchCount: params.matchCount,
              useExactPhrase: params.useExactPhrase,
              signal: params.signal,
            })
          : Promise.resolve({
              chunks: [] as KnowledgeChunk[],
              backend: 'pg' as const,
              fallbackToPg: false,
            });
        if (!useKeyword) {
          skippedChannels.push('keyword');
        }

        const [vectorResults, keywordResult] = await Promise.all([
          vectorPromise,
          keywordPromise,
        ]);

        return {
          chunks: this.fuse(vectorResults, keywordResult.chunks).slice(
            0,
            params.matchCount,
          ),
          keywordBackend: useKeyword ? keywordResult.backend : 'disabled',
          vectorResultCount: vectorResults.length,
          keywordResultCount: keywordResult.chunks.length,
          fallbackToPg: keywordResult.fallbackToPg,
          skippedChannels,
        };
      },
    );
  }

  // ==========================================
  // Vector Supabase RPC 向量检索
  // ==========================================
  private async vectorRetrieve(params: {
    knowledgeId: string;
    queryEmbedding: number[];
    threshold: number;
    matchCount: number;
    signal?: AbortSignal;
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
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
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

        if (error) {
          throw new Error(error.message);
        }

        return (data ?? []).map((chunk) => ({
          ...chunk,
          retrieval_sources: ['vector'],
        }));
      },
    );
  }

  // ==========================================
  // 其他辅助函数
  // ==========================================
  private fuse(
    vectorResults: KnowledgeChunk[],
    keywordResults: KnowledgeChunk[],
  ): KnowledgeChunk[] {
    const merged = new Map<string, KnowledgeChunk>();
    const vectorRanks = new Map<string, number>();
    const keywordRanks = new Map<string, number>();

    vectorResults.forEach((chunk, index) => {
      vectorRanks.set(chunk.id, index + 1);
      const existing = merged.get(chunk.id);
      merged.set(
        chunk.id,
        existing
          ? {
              ...existing,
              similarity: Math.max(
                existing.similarity ?? 0,
                chunk.similarity ?? 0,
              ),
              retrieval_sources: this.mergeSources(existing, 'vector'),
            }
          : { ...chunk, retrieval_sources: ['vector'] },
      );
    });

    keywordResults.forEach((chunk, index) => {
      keywordRanks.set(chunk.id, index + 1);
      const existing = merged.get(chunk.id);
      merged.set(
        chunk.id,
        existing
          ? {
              ...existing,
              keyword_score: Math.max(
                existing.keyword_score ?? 0,
                chunk.keyword_score ?? 0,
              ),
              retrieval_sources: this.mergeSources(existing, 'keyword'),
            }
          : { ...chunk, retrieval_sources: ['keyword'] },
      );
    });

    return Array.from(merged.values())
      .map((chunk) => ({
        ...chunk,
        hybrid_score:
          this.rrf(vectorRanks.get(chunk.id)) +
          this.rrf(keywordRanks.get(chunk.id)),
      }))
      .sort((left, right) => this.compareChunks(right, left));
  }

  private compareChunks(left: KnowledgeChunk, right: KnowledgeChunk): number {
    return (
      (left.hybrid_score ?? 0) - (right.hybrid_score ?? 0) ||
      (left.keyword_score ?? 0) - (right.keyword_score ?? 0) ||
      (left.similarity ?? 0) - (right.similarity ?? 0)
    );
  }

  private mergeSources(
    chunk: KnowledgeChunk,
    source: 'vector' | 'keyword',
  ): KnowledgeRetrievalSource[] {
    return Array.from(new Set([...(chunk.retrieval_sources ?? []), source]));
  }

  private rrf(rank?: number): number {
    if (!rank) return 0;
    return 1 / (RRF_K + rank);
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
    };
  }

  private async retrieveGraphChunks(
    knowledgeId: string,
    retrievalQuery: string,
    keywordTerms: string[],
    matchCount: number,
    strategy: RetrievalStrategy,
    signal?: AbortSignal,
  ): Promise<KnowledgeChunk[]> {
    const graphRetriever = this.graphRetriever;
    if (!this.isGraphRetrieverEnabled(strategy) || !graphRetriever) return [];

    try {
      return await graphRetriever.retrieve({
        knowledgeId,
        retrievalQuery,
        keywordTerms,
        matchCount,
        graphMaxHops: strategy.graphMaxHops,
        graphMode: strategy.graphMode,
        signal,
      });
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
    return {
      needRetrieval: true,
      useVector: input.channels.useVector,
      useKeyword: input.channels.useKeyword,
      useGraph: input.channels.useGraph,
      useExactPhrase: input.channels.useExactPhrase,
      useMultiQuery: input.retrievalQueries.length > 1,
      allowWeb: false,
      queryCount: input.retrievalQueries.length,
      chunkContextWindow: 0,
      reason: 'persona stage1 检索',
    };
  }

  private async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<MountedKnowledgeConfig[]> {
    if (!this.personaKnowledgeConfigService) {
      throw new Error('缺少 PersonaKnowledgeConfigService，无法执行 persona 检索');
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

  private resolveStage1TopK(
    stage1TopK: number | undefined,
    config: MountedKnowledgeConfig,
  ): number {
    return stage1TopK === undefined
      ? config.stage1TopK
      : this.runtime.toBoundedNumber(stage1TopK, config.stage1TopK, 1, 50);
  }

  private resolvePersonaConcurrency(): number {
    return this.runtime.toBoundedNumber(
      process.env.RAG_PERSONA_KB_CONCURRENCY,
      3,
      1,
      8,
    );
  }
}
