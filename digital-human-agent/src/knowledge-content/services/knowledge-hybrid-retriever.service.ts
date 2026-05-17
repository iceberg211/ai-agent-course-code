import { Injectable } from '@nestjs/common';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/knowledge-keyword-retriever.service';
import { KnowledgeVectorRetrieverService } from '@/knowledge-content/services/knowledge-vector-retriever.service';
import type {
  KnowledgeChunk,
  KnowledgeRetrievalSource,
  KeywordBackend,
} from '@/knowledge-content/types/knowledge-content.types';

interface HybridRetrieveParams {
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
}

export interface HybridRetrieveResult {
  chunks: KnowledgeChunk[];
  keywordBackend: KeywordBackend | 'disabled';
  vectorResultCount: number;
  keywordResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'graph'>;
}

const RRF_K = 60;

@Injectable()
export class KnowledgeHybridRetrieverService {
  constructor(
    private readonly vectorRetriever: KnowledgeVectorRetrieverService,
    private readonly keywordRetriever: KnowledgeKeywordRetrieverService,
  ) {}

  async retrieve(params: HybridRetrieveParams): Promise<HybridRetrieveResult> {
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
            ? this.vectorRetriever.retrieve({
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
}
