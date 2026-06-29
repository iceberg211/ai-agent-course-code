import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RerankerProvider } from './reranker.provider';
import { LlmRerankerProvider } from './llm-reranker.provider';
import { NoopRerankerProvider } from './noop-reranker.provider';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly provider: RerankerProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmRerankerProvider,
    private readonly noopProvider: NoopRerankerProvider,
  ) {
    const providerType =
      String(this.configService.get<string>('RERANKER_PROVIDER') ?? '')
        .trim()
        .toLowerCase() || 'llm';

    this.logger.log(`初始化 Reranker 门面服务，当前选择的 Provider: ${providerType}`);
    
    if (providerType === 'noop') {
      this.provider = this.noopProvider;
    } else {
      this.provider = this.llmProvider;
    }
  }

  async rerank(
    query: string,
    candidates: KnowledgeChunk[],
    topK = 5,
    signal?: AbortSignal,
    minScore?: number,
  ): Promise<KnowledgeChunk[]> {
    if (!candidates.length || topK <= 0) {
      return [];
    }
    return this.provider.rerank({ query, candidates, topK, signal, minScore });
  }
}
