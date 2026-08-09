import { Injectable } from '@nestjs/common';
import {
  RerankerProvider,
  type RerankInput,
} from '@/knowledge/services/retrieval/processing/reranker.provider';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

/**
 * 专用/轻量 rerank：按 hybrid/similarity 等已有分数排序，不调用 LLM。
 * 对应 profile.rerankMode = score | dedicated（无外部 cross-encoder 时）。
 */
@Injectable()
export class ScoreRerankerProvider implements RerankerProvider {
  async rerank(input: RerankInput): Promise<KnowledgeChunk[]> {
    const { candidates, topK = 5, minScore } = input;
    if (!candidates.length || topK <= 0) return [];

    const ranked = [...candidates]
      .map((chunk) => ({
        ...chunk,
        rerank_score: this.scoreOf(chunk),
      }))
      .sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0));

    const filtered =
      minScore === undefined
        ? ranked
        : ranked.filter((c) => (c.rerank_score ?? 0) >= minScore);

    return filtered.slice(0, Math.min(topK, filtered.length));
  }

  private scoreOf(chunk: KnowledgeChunk): number {
    return Math.max(
      chunk.rerank_score ?? 0,
      (chunk.hybrid_score ?? 0) * 10,
      (chunk.rrf_score ?? 0) * 10,
      (chunk.similarity ?? 0) * 10,
      chunk.keyword_score ?? 0,
      (chunk.graph_score ?? 0) * 5,
    );
  }
}
