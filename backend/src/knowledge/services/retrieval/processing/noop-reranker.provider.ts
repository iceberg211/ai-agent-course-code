import { Injectable } from '@nestjs/common';
import { RerankerProvider, RerankInput } from './reranker.provider';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class NoopRerankerProvider implements RerankerProvider {
  async rerank(input: RerankInput): Promise<KnowledgeChunk[]> {
    const topK = input.topK ?? 5;
    return input.candidates.slice(0, topK).map((chunk) => ({
      ...chunk,
      rerank_score: 1.0,
    }));
  }
}
