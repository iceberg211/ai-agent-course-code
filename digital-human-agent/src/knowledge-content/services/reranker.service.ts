import { Injectable, Logger } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { LlmJsonRerankerProvider } from '@/knowledge-content/rerankers/llm-json-reranker.provider';
import type { RerankerProviderItem } from '@/knowledge-content/rerankers/reranker-provider.interface';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);

  constructor(private readonly llmJsonProvider: LlmJsonRerankerProvider) {}

  async rerank(
    query: string,
    candidates: KnowledgeChunk[],
    topK = 5,
    signal?: AbortSignal,
  ): Promise<KnowledgeChunk[]> {
    throwIfAborted(signal);

    if (!candidates.length || topK <= 0) {
      return [];
    }

    const safeTopK = Math.min(Math.max(topK, 1), candidates.length);
    try {
      const parsed = await this.llmJsonProvider.rerank({
        query,
        candidates,
        topK: safeTopK,
        signal,
      });
      return this.applyScores(candidates, parsed, safeTopK);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(
        `${this.llmJsonProvider.name} rerank 失败，保留 Stage1 排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return candidates.slice(0, safeTopK);
  }

  private applyScores(
    candidates: KnowledgeChunk[],
    parsed: RerankerProviderItem[],
    safeTopK: number,
  ): KnowledgeChunk[] {
    const scoreMap = new Map<number, number>();

    for (const item of parsed) {
      if (
        Number.isInteger(item.index) &&
        item.index >= 0 &&
        item.index < candidates.length &&
        Number.isFinite(item.score)
      ) {
        scoreMap.set(item.index, item.score);
      }
    }

    const reranked = candidates.map((chunk, index) => ({
      ...chunk,
      rerank_score: scoreMap.get(index) ?? 0,
    }));

    reranked.sort((a, b) => {
      const scoreDiff = (b.rerank_score ?? 0) - (a.rerank_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.similarity ?? 0) - (a.similarity ?? 0);
    });

    return reranked.slice(0, safeTopK);
  }
}
