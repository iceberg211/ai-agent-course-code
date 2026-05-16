import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { throwIfAborted } from '@/agent/agent.utils';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  buildKnowledgeHydePromptInput,
  buildKnowledgeQueryRewritePromptInput,
  KNOWLEDGE_HYDE_PROMPT,
  KNOWLEDGE_QUERY_REWRITE_PROMPT,
} from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import { extractFallbackKeywordTerms } from '@/knowledge-content/keyword-retrievers/keyword-retriever.utils';
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryAngle,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';

const DEFAULT_EXPANDED_QUERY_COUNT = 3;
const KEYWORD_SPLIT_PATTERN = /[、,，;；\s]+/u;

const KeywordListSchema = z.union([
  z.array(z.string().min(1).max(50)).min(1).max(6),
  z.string().min(1).max(300),
]);

const KnowledgeQueryRewriteSchema = z.object({
  rewrittenQuery: z.string().min(1).max(500),
  keywords: KeywordListSchema,
  expandedQueries: z
    .array(
      z.object({
        query: z.string().min(1).max(500),
        keywords: KeywordListSchema,
        angle: z
          .enum(['original', 'entity', 'semantic', 'symptom', 'detail'])
          .default('semantic'),
      }),
    )
    .min(1)
    .max(5)
    .optional(),
  reason: z.string().min(1).max(200),
});

@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.QUERY_REWRITE_MODEL_NAME ??
      process.env.MODEL_NAME ??
      DEFAULT_LLM_MODEL_NAME,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async rewrite(
    query: string,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    const normalizedQuery = query.trim();
    throwIfAborted(signal);

    if (!normalizedQuery) {
      return this.buildFallbackResult('', '原始问题为空，跳过改写');
    }

    return runInTracedScope(
      {
        name: 'knowledge_query_rewrite',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'rewrite'],
        metadata: {
          queryLength: normalizedQuery.length,
        },
        input: {
          query: normalizedQuery,
        },
        outputProcessor: (output) => ({
          rewrittenQuery: output.rewrittenQuery,
          keywordCount: output.keywords.length,
          changed: output.changed,
          reason: output.reason,
        }),
      },
      async () => {
        throwIfAborted(signal);

        try {
          const rewriter = this.llm.withStructuredOutput(
            KnowledgeQueryRewriteSchema,
          );
          const result = await rewriter.invoke(
            await KNOWLEDGE_QUERY_REWRITE_PROMPT.formatMessages(
              buildKnowledgeQueryRewritePromptInput(normalizedQuery),
            ),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'knowledge_query_rewrite_llm',
                tags: ['knowledge', 'rag', 'rewrite', 'llm'],
                metadata: {
                  originalQuery: normalizedQuery,
                },
              }),
              signal,
            },
          );

          throwIfAborted(signal);

          const rewrittenQuery =
            result.rewrittenQuery.trim() || normalizedQuery;
          const keywords = this.normalizeKeywords(
            result.keywords,
            normalizedQuery,
          );
          const expandedQueries = this.normalizeExpandedQueries(
            result.expandedQueries,
            rewrittenQuery,
            keywords,
          );
          return {
            originalQuery: normalizedQuery,
            rewrittenQuery,
            keywords,
            expandedQueries,
            changed: rewrittenQuery !== normalizedQuery,
            reason: result.reason.trim() || '改写完成',
          };
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }

          this.logger.warn(
            `Query Rewrite 失败，回退原问题：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.buildFallbackResult(
            normalizedQuery,
            '改写失败，已回退原问题',
          );
        }
      },
    );
  }

  async generateHypotheticalAnswer(
    query: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const normalizedQuery = query.trim();
    throwIfAborted(signal);
    if (!normalizedQuery) return '';

    return runInTracedScope(
      {
        name: 'knowledge_hyde_generation',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'hyde'],
        input: {
          query: normalizedQuery,
        },
        outputProcessor: (output) => ({
          length: output.length,
        }),
      },
      async () => {
        try {
          const response = await this.llm.invoke(
            await KNOWLEDGE_HYDE_PROMPT.formatMessages(
              buildKnowledgeHydePromptInput(normalizedQuery),
            ),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'knowledge_hyde_llm',
                tags: ['knowledge', 'rag', 'hyde', 'llm'],
                metadata: {
                  query: normalizedQuery,
                },
              }),
              signal,
            },
          );
          throwIfAborted(signal);
          return this.extractText(response.content).slice(0, 600);
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }
          this.logger.warn(
            `HyDE 生成失败，跳过 HyDE 召回：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return '';
        }
      },
    );
  }

  private buildFallbackResult(
    query: string,
    reason: string,
  ): KnowledgeQueryRewriteResult {
    return {
      originalQuery: query,
      rewrittenQuery: query,
      keywords: this.normalizeKeywords([], query),
      expandedQueries: this.normalizeExpandedQueries(
        [],
        query,
        this.normalizeKeywords([], query),
      ),
      changed: false,
      reason,
    };
  }

  private normalizeExpandedQueries(
    expandedQueries: Array<{
      query: string;
      keywords?: unknown;
      angle?: RetrievalQueryAngle;
    }> = [],
    rewrittenQuery: string,
    keywords: string[],
  ): RetrievalQueryItem[] {
    const seen = new Set<string>();
    const items = [
      {
        query: rewrittenQuery,
        keywords,
        angle: 'original' as RetrievalQueryAngle,
      },
      ...expandedQueries,
    ];

    const normalizedItems = items
      .map((item) => ({
        query: item.query.trim(),
        keywords: this.normalizeKeywords(item.keywords ?? [], item.query),
        angle: item.angle ?? ('semantic' as RetrievalQueryAngle),
      }))
      .filter((item) => {
        if (!item.query) return false;
        const key = item.query.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);

    return this.padExpandedQueries(
      normalizedItems,
      rewrittenQuery,
      keywords,
      DEFAULT_EXPANDED_QUERY_COUNT,
    )
      .slice(0, 5)
      .map((item, index) => ({
        index,
        ...item,
      }));
  }

  private padExpandedQueries(
    items: Array<{
      query: string;
      keywords: string[];
      angle: RetrievalQueryAngle;
    }>,
    rewrittenQuery: string,
    keywords: string[],
    targetCount: number,
  ): Array<{
    query: string;
    keywords: string[];
    angle: RetrievalQueryAngle;
  }> {
    const padded = [...items];
    if (!rewrittenQuery.trim() || padded.length >= targetCount) {
      return padded;
    }

    const seen = new Set(padded.map((item) => item.query.toLowerCase()));
    const normalizedKeywords = this.normalizeKeywords(keywords, rewrittenQuery);
    const keywordQuery = normalizedKeywords.join(' ').trim();
    const compactKeywords = normalizedKeywords.slice(0, 4).join(' ').trim();
    const headKeywords = normalizedKeywords.slice(0, 2).join(' ').trim();

    const candidates = [
      {
        query: keywordQuery,
        keywords: normalizedKeywords,
        angle: 'entity' as RetrievalQueryAngle,
      },
      {
        query: [rewrittenQuery, compactKeywords].filter(Boolean).join(' '),
        keywords: normalizedKeywords,
        angle: 'semantic' as RetrievalQueryAngle,
      },
      {
        query: [headKeywords, rewrittenQuery].filter(Boolean).join(' '),
        keywords: normalizedKeywords,
        angle: 'detail' as RetrievalQueryAngle,
      },
      {
        query: `${rewrittenQuery} 相关信息`,
        keywords: normalizedKeywords,
        angle: 'semantic' as RetrievalQueryAngle,
      },
      {
        query: `${rewrittenQuery} 具体说明`,
        keywords: normalizedKeywords,
        angle: 'detail' as RetrievalQueryAngle,
      },
    ];

    for (const candidate of candidates) {
      const query = candidate.query.trim();
      if (!query) continue;
      const key = query.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      padded.push(candidate);
      if (padded.length >= targetCount) return padded;
    }

    return padded;
  }

  private normalizeKeywords(keywords: unknown, query: string): string[] {
    const keywordItems = Array.isArray(keywords)
      ? keywords
      : typeof keywords === 'string'
        ? keywords.split(KEYWORD_SPLIT_PATTERN)
        : [];

    const normalized = Array.from(
      new Set(
        keywordItems
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length >= 2),
      ),
    ).slice(0, 6);

    if (normalized.length > 0) {
      return normalized;
    }

    return extractFallbackKeywordTerms(query).slice(0, 6);
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';

    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('\n')
      .trim();
  }
}
