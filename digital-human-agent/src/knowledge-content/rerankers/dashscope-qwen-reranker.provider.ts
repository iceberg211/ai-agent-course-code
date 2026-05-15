import { Injectable } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import type {
  RerankerProvider,
  RerankerProviderInput,
  RerankerProviderItem,
} from '@/knowledge-content/rerankers/reranker-provider.interface';

interface DashScopeRerankResponse {
  output?: {
    results?: Array<{
      index?: number;
      relevance_score?: number;
    }>;
  };
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
}

@Injectable()
export class DashScopeQwenRerankerProvider implements RerankerProvider {
  readonly name = 'dashscope';
  readonly model = process.env.RERANKER_MODEL ?? 'qwen3-rerank';
  private readonly endpoint =
    process.env.DASHSCOPE_RERANKER_ENDPOINT ??
    'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank';
  private readonly timeoutMs = this.toPositiveInteger(
    process.env.RERANKER_TIMEOUT_MS,
    8000,
  );

  async rerank(
    input: RerankerProviderInput,
  ): Promise<RerankerProviderItem[]> {
    throwIfAborted(input.signal);

    const apiKey = String(process.env.DASHSCOPE_API_KEY ?? '').trim();
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置，无法使用 DashScope reranker');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: {
            query: input.query,
            documents: input.candidates.map((chunk) =>
              this.buildDocumentText(chunk),
            ),
          },
          parameters: {
            top_n: Math.min(input.topK, input.candidates.length),
            return_documents: false,
          },
        }),
        signal: controller.signal,
      });

      throwIfAborted(input.signal);

      if (!response.ok) {
        throw new Error(
          `DashScope rerank HTTP ${response.status}: ${await response.text()}`,
        );
      }

      const payload = (await response.json()) as DashScopeRerankResponse;
      return this.parsePayload(payload, input.candidates.length);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  private parsePayload(
    payload: DashScopeRerankResponse,
    candidateCount: number,
  ): RerankerProviderItem[] {
    const results = payload.output?.results ?? payload.results;
    if (!Array.isArray(results)) {
      throw new Error('DashScope rerank 返回格式缺少 results');
    }

    const parsed = results
      .map((item) => ({
        index: Number(item.index),
        score: Number(item.relevance_score),
      }))
      .filter(
        (item) =>
          Number.isInteger(item.index) &&
          item.index >= 0 &&
          item.index < candidateCount &&
          Number.isFinite(item.score),
      );

    if (parsed.length === 0 && candidateCount > 0) {
      throw new Error('DashScope rerank 返回结果为空或格式异常');
    }

    return parsed;
  }

  private buildDocumentText(chunk: { content: string; source: string }): string {
    return [`来源：${chunk.source}`, chunk.content.slice(0, 1800)].join('\n');
  }

  private toPositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }
}
