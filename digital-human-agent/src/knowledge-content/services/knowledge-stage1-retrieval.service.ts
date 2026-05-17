import { Injectable, Logger, Optional } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/agent/agent.utils';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';
import { Neo4jGraphRetrieverService } from '@/knowledge-content/graph/neo4j-graph-retriever.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import {
  fuseStage1Channels,
  mergeStage1Results,
} from '@/knowledge-content/services/knowledge-retrieval-fusion';
import {
  KnowledgeHybridRetrieverService,
  type HybridRetrieveResult,
} from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import type {
  GraphBackend,
  KeywordBackend,
  KnowledgeChunk,
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';

export interface KnowledgeStage1RetrievalParams {
  knowledgeId: string;
  retrievalQueries: RetrievalQueryItem[];
  hydeQueryEmbedding?: number[];
  strategy: RetrievalStrategy;
  threshold: number;
  globalStage1TopK: number;
  signal?: AbortSignal;
}

export interface KnowledgeStage1RetrievalResult {
  chunks: KnowledgeChunk[];
  trace: RetrieveKnowledgeTraceItem[];
}

@Injectable()
export class KnowledgeStage1RetrievalService {
  private readonly logger = new Logger(KnowledgeStage1RetrievalService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly hybridRetriever: KnowledgeHybridRetrieverService,
    @Optional()
    private readonly graphRetriever?: Neo4jGraphRetrieverService,
  ) {}

  async retrieveForKnowledge(
    params: KnowledgeStage1RetrievalParams,
  ): Promise<KnowledgeStage1RetrievalResult> {
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
        hydeQueryEmbedding: params.hydeQueryEmbedding,
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
        hydeVectorResultCount: stage1Result.hydeVectorResultCount,
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

  private async retrieveStage1(params: {
    knowledgeId: string;
    queryEmbedding: number[] | undefined;
    hydeQueryEmbedding: number[] | undefined;
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
        ? await this.hybridRetriever.retrieve({
            knowledgeId: params.knowledgeId,
            queryEmbedding: params.queryEmbedding,
            hydeQueryEmbedding: params.hydeQueryEmbedding,
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

  private buildSkippedHybridResult(
    strategy: RetrievalStrategy,
  ): HybridRetrieveResult {
    const skippedChannels = new Set<'vector' | 'keyword' | 'hyde' | 'graph'>();
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
    if (sources.includes('vector') || sources.includes('hyde')) {
      return 'pgvector';
    }

    return undefined;
  }
}
