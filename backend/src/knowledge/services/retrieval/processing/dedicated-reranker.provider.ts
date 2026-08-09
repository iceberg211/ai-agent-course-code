import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAbortError, throwIfAborted } from '@/common/utils';
import {
  RerankerProvider,
  type RerankInput,
} from '@/knowledge/services/retrieval/processing/reranker.provider';
import { ScoreRerankerProvider } from '@/knowledge/services/retrieval/processing/score-reranker.provider';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import {
  addTurnDegradation,
  tryConsumeAuxiliaryLlmBudget,
  withRemainingTurnTimeout,
} from '@/common/rag/turn-budget.context';

/**
 * 真 dedicated rerank：
 * - 配置了 RERANKER_DEDICATED_ENDPOINT 时走 HTTP 外部 rerank API
 * - 未配置时降级 ScoreReranker（并打 degradation flag）
 *
 * 期望 API（兼容 Cohere / 多数自建服务）：
 * POST { endpoint }
 * body: { model?, query, documents: string[] }
 * response: { results: [{ index, relevance_score }] }
 */
@Injectable()
export class DedicatedRerankerProvider implements RerankerProvider {
  private readonly logger = new Logger(DedicatedRerankerProvider.name);
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly scoreFallback: ScoreRerankerProvider,
  ) {
    this.endpoint = String(
      this.configService.get<string>('RERANKER_DEDICATED_ENDPOINT') ?? '',
    ).trim();
    this.apiKey = String(
      this.configService.get<string>('RERANKER_DEDICATED_API_KEY') ??
        this.configService.get<string>('OPENAI_API_KEY') ??
        '',
    ).trim();
    this.model = String(
      this.configService.get<string>('RERANKER_DEDICATED_MODEL') ??
        'gte-rerank',
    ).trim();
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  async rerank(input: RerankInput): Promise<KnowledgeChunk[]> {
    const { query, candidates, topK = 5, signal, minScore } = input;
    throwIfAborted(signal);

    if (!candidates.length || topK <= 0) {
      return [];
    }

    if (!this.isConfigured()) {
      addTurnDegradation('rerank_dedicated_score_fallback');
      return this.scoreFallback.rerank(input);
    }

    // 外部 rerank 也计入 LLM/模型预算，避免刷爆
    if (!tryConsumeAuxiliaryLlmBudget(1)) {
      addTurnDegradation('budget_llm');
      addTurnDegradation('rerank_dedicated_score_fallback');
      return this.scoreFallback.rerank(input);
    }

    try {
      const documents = candidates.map((c) =>
        c.content.slice(0, 2000).replace(/\s+/g, ' ').trim(),
      );
      const response = await withRemainingTurnTimeout(
        'dedicated_rerank',
        (childSignal) =>
          fetch(this.endpoint, {
            method: 'POST',
            headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey
            ? { Authorization: `Bearer ${this.apiKey}` }
            : {}),
            },
            body: JSON.stringify({
          model: this.model,
          query,
          documents,
          top_n: Math.min(topK, candidates.length),
            }),
            signal: childSignal,
          }),
        signal,
      );

      throwIfAborted(signal);

      if (!response.ok) {
        throw new Error(
          `dedicated rerank HTTP ${response.status}: ${await response
            .text()
            .catch(() => '')}`,
        );
      }

      const payload = (await response.json()) as {
        results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
        data?: Array<{ index?: number; relevance_score?: number; score?: number }>;
      };
      const results = payload.results ?? payload.data ?? [];
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error('dedicated rerank 返回空 results');
      }

      const scored: Array<{ chunk: KnowledgeChunk; score: number }> = [];
      for (const item of results) {
        const index = Number(item.index);
        const score = Number(item.relevance_score ?? item.score ?? 0);
        if (!Number.isFinite(index) || index < 0 || index >= candidates.length) {
          continue;
        }
        scored.push({
          chunk: {
            ...candidates[index],
            rerank_score: score,
          },
          score,
        });
      }
      scored.sort((a, b) => b.score - a.score);

      const filtered =
        minScore === undefined
          ? scored
          : scored.filter((row) => row.score >= minScore);

      return filtered.slice(0, topK).map((row) => row.chunk);
    } catch (error) {
      if (isAbortError(error) && signal?.aborted) {
        throw error;
      }
      this.logger.warn(
        `dedicated rerank 失败，回退 score：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      addTurnDegradation('rerank_dedicated_failed');
      return this.scoreFallback.rerank(input);
    }
  }
}
