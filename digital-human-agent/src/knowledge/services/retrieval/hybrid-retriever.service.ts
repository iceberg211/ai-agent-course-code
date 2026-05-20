import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isAbortError,
  isTransientInfrastructureError,
  throwIfAborted,
} from '@/common/utils';
import type { RetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import {
  DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG,
} from '@/common/constants';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';
import {
  fuseHybridAndGraphChannels,
  mergeHybridResults,
  fuseVectorAndKeywordResults,
} from '@/knowledge/services/retrieval/knowledge-retrieval-fusion';
import { PersonaKnowledgeConfigService } from '@/knowledge/services/manage/persona-knowledge-config.service';
import { VectorRetrieverService } from './vector-retriever.service';
import { FulltextRetrieverService } from './fulltext-retriever.service';
import type {
  GraphBackend,
  KeywordBackend,
  KnowledgeChunk,
  MountedKnowledgeConfig,
  RetrieveKnowledgeTraceItem,
  KnowledgeHybridRetrievalParams,
  KnowledgeHybridRetrievalResult,
  PersonaHybridRetrievalInput,
  PersonaHybridRetrievalResult,
} from '@/knowledge/types/knowledge-content.types';

interface HybridRetrieveResult {
  chunks: KnowledgeChunk[];
  keywordBackend: KeywordBackend | 'disabled';
  vectorResultCount: number;
  keywordResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'graph'>;
}

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

@Injectable()
export class HybridRetrieverService {
  private readonly logger = new Logger(HybridRetrieverService.name);

  constructor(
    private readonly runtime: ContentRuntimeService,
    private readonly configService: ConfigService,
    private readonly vectorRetriever: VectorRetrieverService,
    private readonly fulltextRetriever: FulltextRetrieverService,
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
        params.globalRetrievalLimit / Math.max(params.retrievalQueries.length, 1),
      ),
    );
    const retrievalTasks = params.retrievalQueries.map(async (retrievalQuery) => {
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

      throwIfAborted(params.signal);

      const hybridResult = await this.retrieveHybridChannels({
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
        skippedChannels: hybridResult.skippedChannels,
      };

      return { chunks, traceItem };
    });

    const taskResults = await Promise.all(retrievalTasks);
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
    const hybridResults = await mapWithConcurrency(
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
            globalRetrievalLimit: this.resolveRetrievalLimit(input.retrievalLimit, config),
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
            `persona 检索失败（knowledge=${config.knowledgeId}）：${
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
      knowledgeCount: knowledgeConfigs.length,
      chunks: mergeHybridResults(
        hybridResults.map((result) => result.chunks),
        input.retrievalLimit === undefined
          ? Math.max(20, ...knowledgeConfigs.map((config) => config.retrievalLimit))
          : this.runtime.toBoundedNumber(input.retrievalLimit, 20, 1, 50),
      ),
      trace: hybridResults.flatMap((result) => result.trace),
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
      chunks: fuseHybridAndGraphChannels(
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
          ? this.keywordRetrieve({
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
          chunks: fuseVectorAndKeywordResults(vectorResults, keywordResult.chunks).slice(
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

  private async vectorRetrieve(params: {
    knowledgeId: string;
    queryEmbedding: number[];
    threshold: number;
    matchCount: number;
    signal?: AbortSignal;
  }): Promise<KnowledgeChunk[]> {
    return this.vectorRetriever.retrieve(params);
  }

  private async keywordRetrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    useExactPhrase?: boolean;
    signal?: AbortSignal;
  }): Promise<{
    chunks: KnowledgeChunk[];
    backend: KeywordBackend;
    fallbackToPg: boolean;
  }> {
    return this.fulltextRetriever.retrieve(params);
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
      useExactPhrase: input.channels.useExactPhrase ?? false,
      useMultiQuery: input.retrievalQueries.length > 1,
      allowWeb: false,
      queryCount: input.retrievalQueries.length,
      chunkContextWindow: 0,
      reason: 'persona 检索',
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

  private resolveRetrievalLimit(
    retrievalLimit: number | undefined,
    config: MountedKnowledgeConfig,
  ): number {
    return retrievalLimit === undefined
      ? config.retrievalLimit
      : this.runtime.toBoundedNumber(retrievalLimit, config.retrievalLimit, 1, 50);
  }

  private resolvePersonaConcurrency(): number {
    return this.runtime.toBoundedNumber(
      this.configService.get<string>('RAG_PERSONA_KB_CONCURRENCY'),
      3,
      1,
      8,
    );
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
}
