import { Injectable, Logger } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import type { RagWebCitation } from '@/agent/types/rag-workflow.types';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';

interface SearchWebParams {
  query: string;
  signal?: AbortSignal;
  count?: number;
}

interface BochaWebPage {
  name?: string;
  url?: string;
  summary?: string;
  siteName?: string;
  dateLastCrawled?: string;
}

interface BochaSearchResponse {
  code?: number;
  msg?: string;
  data?: {
    webPages?: {
      value?: BochaWebPage[];
    };
  };
}

@Injectable()
export class WebFallbackService {
  private readonly logger = new Logger(WebFallbackService.name);

  isEnabled(): boolean {
    return Boolean(String(process.env.BOCHA_API_KEY ?? '').trim());
  }

  async search(params: SearchWebParams): Promise<RagWebCitation[]> {
    const normalizedQuery = params.query.trim();
    if (!normalizedQuery) return [];
    if (!this.isEnabled()) {
      this.logger.warn('BOCHA_API_KEY 未配置，跳过联网补充');
      return [];
    }

    return runInTracedScope(
      {
        name: 'rag_web_fallback_search',
        runType: 'retriever',
        tags: ['agent', 'rag', 'web', 'fallback'],
        metadata: {
          queryLength: normalizedQuery.length,
          count: params.count ?? 8,
        },
        input: {
          query: normalizedQuery,
        },
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
      },
      () => this.searchInternal(normalizedQuery, params.signal, params.count),
    );
  }

  formatContextBlock(citations: RagWebCitation[]): string {
    if (citations.length === 0) {
      return '';
    }

    return citations
      .map(
        (item, index) =>
          `[网页 ${index + 1}]
标题：${item.title}
URL：${item.url}
网站：${item.siteName ?? '未知'}
时间：${item.publishedAt ?? '未知'}
摘要：${item.snippet}`,
      )
      .join('\n\n');
  }

  private async searchInternal(
    query: string,
    signal?: AbortSignal,
    count = 8,
  ): Promise<RagWebCitation[]> {
    throwIfAborted(signal);

    const response = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(process.env.BOCHA_API_KEY ?? '').trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        freshness: 'noLimit',
        summary: true,
        count,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `联网搜索失败，状态码=${response.status}，错误=${errorText}`,
      );
    }

    const result = (await response.json()) as BochaSearchResponse;
    if (result.code !== 200 || !result.data) {
      throw new Error(`联网搜索返回失败：${result.msg ?? '未知错误'}`);
    }

    const pages = result.data.webPages?.value ?? [];
    return pages
      .map((page) => this.toCitation(page))
      .filter((item): item is RagWebCitation => item !== null);
  }

  private toCitation(page: BochaWebPage): RagWebCitation | null {
    const title = String(page.name ?? '').trim();
    const url = String(page.url ?? '').trim();
    const snippet = String(page.summary ?? '').trim();
    if (!title || !url || !snippet) {
      return null;
    }

    return {
      kind: 'web',
      title,
      url,
      snippet,
      siteName: String(page.siteName ?? '').trim() || null,
      publishedAt: String(page.dateLastCrawled ?? '').trim() || null,
    };
  }
}
