import { Injectable, Logger } from '@nestjs/common';
import { FusionService } from './retrieval/fusion.service';
import type {
  HybridRetrievalResult,
  KnowledgeChunk,
  NormalizedRetrieveOptions,
} from './domain/retrieval.types';
import { KeywordRetrieverService } from './retrieval/keyword-retriever.service';
import { VectorRetrieverService } from './retrieval/vector-retriever.service';

@Injectable()
export class HybridRetrievalService {
  private readonly logger = new Logger(HybridRetrievalService.name);

  constructor(
    private readonly vectorRetriever: VectorRetrieverService,
    private readonly keywordRetriever: KeywordRetrieverService,
    private readonly fusionService: FusionService,
  ) {}

  needsVectorEmbedding(
    mode: NormalizedRetrieveOptions['retrievalMode'],
  ): boolean {
    return mode === 'vector' || mode === 'hybrid';
  }

  async retrieveForKnowledgeBase(params: {
    kbId: string;
    query: string;
    options: NormalizedRetrieveOptions;
    queryEmbedding?: number[];
  }): Promise<HybridRetrievalResult> {
    const { kbId, query, options, queryEmbedding } = params;

    if (options.retrievalMode === 'vector') {
      const vectorHits = await this.requireVectorHits(
        kbId,
        queryEmbedding,
        options.threshold,
        options.vectorTopK,
      );
      return {
        vectorHits,
        keywordHits: [],
        stage1Hits: vectorHits,
      };
    }

    if (options.retrievalMode === 'keyword') {
      const keywordHits = await this.keywordRetriever.retrieve(
        kbId,
        query,
        options.keywordTopK,
      );
      return {
        vectorHits: [],
        keywordHits,
        stage1Hits: keywordHits.slice(0, options.candidateLimit),
      };
    }

    const [vectorResult, keywordResult] = await Promise.allSettled([
      this.requireVectorHits(
        kbId,
        queryEmbedding,
        options.threshold,
        options.vectorTopK,
      ),
      this.keywordRetriever.retrieve(kbId, query, options.keywordTopK),
    ]);
    const vectorHits =
      vectorResult.status === 'fulfilled' ? vectorResult.value : [];
    const keywordHits =
      keywordResult.status === 'fulfilled' ? keywordResult.value : [];

    if (vectorResult.status === 'rejected') {
      this.logger.warn(
        `hybrid 向量召回失败（kb=${kbId}），继续使用关键词结果：${
          vectorResult.reason instanceof Error
            ? vectorResult.reason.message
            : String(vectorResult.reason)
        }`,
      );
    }
    if (keywordResult.status === 'rejected') {
      this.logger.warn(
        `hybrid 关键词召回失败（kb=${kbId}），继续使用向量结果：${
          keywordResult.reason instanceof Error
            ? keywordResult.reason.message
            : String(keywordResult.reason)
        }`,
      );
    }

    return {
      vectorHits,
      keywordHits,
      stage1Hits: this.fusionService.fuse(vectorHits, keywordHits, {
        rrfK: options.fusion.rrfK,
        vectorWeight: options.fusion.vectorWeight,
        keywordWeight: options.fusion.keywordWeight,
        candidateLimit: options.candidateLimit,
      }),
    };
  }

  private async requireVectorHits(
    kbId: string,
    queryEmbedding: number[] | undefined,
    threshold: number,
    topK: number,
  ): Promise<KnowledgeChunk[]> {
    if (!queryEmbedding?.length) {
      throw new Error('vector/hybrid 检索缺少 queryEmbedding');
    }
    return this.vectorRetriever.retrieve(kbId, queryEmbedding, threshold, topK);
  }
}
