import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RerankerProvider } from './reranker.provider';
import { LlmRerankerProvider } from './llm-reranker.provider';
import { NoopRerankerProvider } from './noop-reranker.provider';
import { ScoreRerankerProvider } from './score-reranker.provider';
import { DedicatedRerankerProvider } from './dedicated-reranker.provider';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly defaultProvider: RerankerProvider;
  private readonly providers: Record<string, RerankerProvider>;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmRerankerProvider,
    private readonly noopProvider: NoopRerankerProvider,
    private readonly scoreProvider: ScoreRerankerProvider,
    private readonly dedicatedProvider: DedicatedRerankerProvider,
  ) {
    const providerType =
      String(this.configService.get<string>('RERANKER_PROVIDER') ?? '')
        .trim()
        .toLowerCase() || 'llm';

    this.providers = {
      llm: this.llmProvider,
      noop: this.noopProvider,
      score: this.scoreProvider,
      dedicated: this.dedicatedProvider,
    };
    this.defaultProvider =
      this.providers[providerType] ?? this.llmProvider;

    this.logger.log(
      `初始化 Reranker 门面：default=${providerType}` +
        (providerType === 'dedicated'
          ? ` configured=${this.dedicatedProvider.isConfigured()}`
          : ''),
    );
  }

  async rerank(
    query: string,
    candidates: KnowledgeChunk[],
    topK = 5,
    signal?: AbortSignal,
    minScore?: number,
    mode?: 'off' | 'score' | 'llm' | 'dedicated' | 'noop',
  ): Promise<KnowledgeChunk[]> {
    if (!candidates.length || topK <= 0) {
      return [];
    }
    if (mode === 'off') {
      return candidates.slice(0, topK);
    }
    const provider =
      (mode && this.providers[mode]) || this.defaultProvider;
    return provider.rerank({ query, candidates, topK, signal, minScore });
  }
}
