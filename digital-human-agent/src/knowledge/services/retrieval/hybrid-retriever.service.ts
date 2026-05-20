import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { estypes } from '@elastic/elasticsearch';
import {
  isAbortError,
  isTransientInfrastructureError,
  throwIfAborted,
} from '@/common/utils';
import type { RetrievalStrategy } from '@/common/rag';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { DEFAULT_HYBRID_KEYWORD_BACKEND } from '@/common/constants';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import type { KnowledgeChunkIndexDocument } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import {
  normalizeKeywordTerms,
  escapeLike,
  buildElasticKeywordShouldClauses,
} from '@/knowledge/services/retrieval/retrieval-utils';
import {
  fuseHybridAndGraphChannels,
  mergeHybridResults,
} from '@/knowledge/services/retrieval/knowledge-retrieval-fusion';
import { PersonaKnowledgeConfigService } from '@/knowledge/services/manage/persona-knowledge-config.service';
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

interface KeywordRow {
  id: string;
  content: string;
  source: string;
  chunk_index: string | number;
  category: string | null;
  knowledge_base_id: string;
  keyword_score: string | number;
}

@Injectable()
export class HybridRetrieverService {
  private readonly logger = new Logger(HybridRetrieverService.name);

  constructor(
    private readonly runtime: ContentRuntimeService,
    private readonly configService: ConfigService,
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
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

    return {
      knowledgeCount: knowledgeConfigs.length,
      chunks: mergeHybridResults(
        hybridResults.map((result) => result.chunks),
        input.retrievalLimit === undefined
          ? Math.max(20, ...knowledgeConfigs.map((config) => config.retrievalLimit))
          : this.runtime.toBoundedNumber(input.retrievalLimit, 20, 1, 50),
      ),
      trace: hybridResults.flatMap((result) => result.trace),
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

  // ==========================================
  // Keyword 检索及其底层逻辑合并
  // ==========================================
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
    const preferredBackend = this.resolvePreferredBackend();
    const elasticsearchEnabled = this.elasticsearchIndexService.isEnabled();
    const initialBackend =
      preferredBackend === 'elastic' && elasticsearchEnabled ? 'elastic' : 'pg';
    const initialFallbackToPg =
      preferredBackend === 'elastic' && initialBackend === 'pg';

    return runInTracedScope(
      {
        name: 'knowledge_keyword_retrieve',
        runType: 'retriever',
        tags: ['knowledge', 'rag', 'retrieve', 'keyword'],
        metadata: {
          knowledgeId: params.knowledgeId,
          matchCount: params.matchCount,
          termCount: params.terms.length,
          preferredBackend,
        },
        input: {
          knowledgeId: params.knowledgeId,
          terms: params.terms,
        },
        outputProcessor: (output) => ({
          resultCount: output.chunks.length,
          backend: output.backend,
          fallbackToPg: output.fallbackToPg,
        }),
      },
      async () => {
        return this.retrieveWithFallback(
          params,
          initialBackend,
          initialFallbackToPg,
        );
      },
    );
  }

  private async retrieveWithFallback(
    params: {
      knowledgeId: string;
      terms: string[];
      matchCount: number;
      useExactPhrase?: boolean;
      signal?: AbortSignal;
    },
    backend: KeywordBackend,
    fallbackToPg: boolean,
  ): Promise<{
    chunks: KnowledgeChunk[];
    backend: KeywordBackend;
    fallbackToPg: boolean;
  }> {
    if (backend === 'pg') {
      const chunks = await this.pgRetrieve(params);
      return {
        chunks,
        backend: 'pg',
        fallbackToPg,
      };
    }

    try {
      const chunks = await this.elasticRetrieve(params);
      return {
        chunks,
        backend: 'elastic',
        fallbackToPg,
      };
    } catch (error) {
      this.logger.warn(
        `ES 关键词检索失败，自动回退 PG：${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      const chunks = await this.pgRetrieve(params);
      return {
        chunks,
        backend: 'pg',
        fallbackToPg: true,
      };
    }
  }

  private async pgRetrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    signal?: AbortSignal;
  }): Promise<KnowledgeChunk[]> {
    throwIfAborted(params.signal);
    const normalizedTerms = normalizeKeywordTerms(params.terms);
    if (normalizedTerms.length === 0) {
      return [];
    }

    const parameters: Record<string, string | number> = {
      knowledgeId: params.knowledgeId,
    };
    const scoreClauses: string[] = [];
    const matchClauses: string[] = [];

    normalizedTerms.forEach((term, index) => {
      const likeParam = `term${index}`;
      parameters[likeParam] = `%${escapeLike(term)}%`;

      const baseWeight = Math.min(8, Math.max(2, term.length));
      const contentWeight = baseWeight * 3;
      const sourceWeight = Math.max(2, Math.round(baseWeight * 1.5));
      const categoryWeight = Math.max(1, Math.round(baseWeight * 1.2));

      scoreClauses.push(
        `CASE WHEN chunk.content ILIKE :${likeParam} ESCAPE '\\' THEN ${contentWeight} ELSE 0 END`,
      );
      scoreClauses.push(
        `CASE WHEN chunk.source ILIKE :${likeParam} ESCAPE '\\' THEN ${sourceWeight} ELSE 0 END`,
      );
      scoreClauses.push(
        `CASE WHEN COALESCE(chunk.category, '') ILIKE :${likeParam} ESCAPE '\\' THEN ${categoryWeight} ELSE 0 END`,
      );

      matchClauses.push(
        `chunk.content ILIKE :${likeParam} ESCAPE '\\'`,
        `chunk.source ILIKE :${likeParam} ESCAPE '\\'`,
        `COALESCE(chunk.category, '') ILIKE :${likeParam} ESCAPE '\\'`,
      );
    });

    const scoreSql = `(${scoreClauses.join(' + ')})`;
    const rows = await this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin(
        KnowledgeDocument,
        'document',
        'document.id = chunk.document_id',
      )
      .select('chunk.id', 'id')
      .addSelect('chunk.content', 'content')
      .addSelect('chunk.source', 'source')
      .addSelect('chunk.chunk_index', 'chunk_index')
      .addSelect('chunk.category', 'category')
      .addSelect('document.knowledge_base_id', 'knowledge_base_id')
      .addSelect(scoreSql, 'keyword_score')
      .where('document.knowledge_base_id = :knowledgeId', {
        knowledgeId: params.knowledgeId,
      })
      .andWhere('chunk.enabled = true')
      .andWhere(`(${matchClauses.join(' OR ')})`)
      .orderBy('keyword_score', 'DESC')
      .addOrderBy('chunk.chunk_index', 'ASC')
      .limit(params.matchCount)
      .setParameters(parameters)
      .getRawMany<KeywordRow>();
    throwIfAborted(params.signal);

    return rows
      .map((row) => {
        const keywordScore = Number(row.keyword_score);
        if (!Number.isFinite(keywordScore) || keywordScore <= 0) {
          return null;
        }

        return {
          id: row.id,
          content: row.content,
          source: row.source,
          chunk_index: Number(row.chunk_index),
          category: row.category,
          similarity: 0,
          knowledge_base_id: row.knowledge_base_id,
          keyword_score: keywordScore,
          retrieval_sources: ['keyword'],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null) as KnowledgeChunk[];
  }

  private async elasticRetrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    useExactPhrase?: boolean;
    signal?: AbortSignal;
  }): Promise<KnowledgeChunk[]> {
    throwIfAborted(params.signal);
    const normalizedTerms = normalizeKeywordTerms(params.terms);
    if (normalizedTerms.length === 0) {
      return [];
    }

    if (!this.elasticsearchIndexService.isEnabled()) {
      throw new Error(
        'ELASTICSEARCH_ENABLED=false，当前无法使用 ES 关键词检索',
      );
    }

    const client = this.elasticsearchIndexService.getClient();
    if (!client) {
      throw new Error('ES client 不可用');
    }

    await this.elasticsearchIndexService.ensureKnowledgeChunkIndex();

    const should = buildElasticKeywordShouldClauses(normalizedTerms, {
      useExactPhrase: params.useExactPhrase === true,
    });

    const searchRequest = {
      index: this.elasticsearchIndexService.getKnowledgeChunkReadAlias(),
      size: params.matchCount,
      query: {
        bool: {
          filter: [
            {
              term: {
                knowledge_base_id: params.knowledgeId,
              },
            },
            {
              term: {
                enabled: true,
              },
            },
          ],
          should,
          minimum_should_match: 1,
        },
      },
      sort: [{ _score: { order: 'desc' } }, { chunk_index: { order: 'asc' } }],
    } satisfies estypes.SearchRequest;
    const response = params.signal
      ? await client.search<KnowledgeChunkIndexDocument>(searchRequest, {
          signal: params.signal,
        })
      : await client.search<KnowledgeChunkIndexDocument>(searchRequest);
    throwIfAborted(params.signal);

    return this.mapResponseToChunks(response);
  }

  private mapResponseToChunks(
    response: estypes.SearchResponse<KnowledgeChunkIndexDocument>,
  ): KnowledgeChunk[] {
    return response.hits.hits
      .map((hit) => {
        const source = hit._source;
        const keywordScore = hit._score ?? 0;
        if (!source || !Number.isFinite(keywordScore) || keywordScore <= 0) {
          return null;
        }

        return {
          id: source.id,
          document_id: source.document_id,
          content: source.content,
          source: source.source,
          chunk_index: Number(source.chunk_index),
          category: source.category,
          similarity: 0,
          knowledge_base_id: source.knowledge_base_id,
          keyword_score: keywordScore,
          retrieval_sources: ['keyword'],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null) as KnowledgeChunk[];
  }

  private resolvePreferredBackend(): KeywordBackend {
    const value = String(
      this.configService.get<string>('HYBRID_KEYWORD_BACKEND') ??
        DEFAULT_HYBRID_KEYWORD_BACKEND,
    )
      .trim()
      .toLowerCase();

    return value === 'elastic' ? 'elastic' : 'pg';
  }
}
