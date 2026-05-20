import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  createDefaultLlmFactoryService,
  LlmFactoryService,
} from '@/common/llm/llm-factory.service';
import {
  buildKnowledgeQueryRewritePromptInput,
  KNOWLEDGE_QUERY_REWRITE_PROMPT,
} from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import { extractFallbackKeywordTerms } from '@/knowledge/services/retrieval/keyword-retriever.service';
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryAngle,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';
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

  private readonly llm: ChatOpenAI;

  constructor(@Optional() llmFactory?: LlmFactoryService) {
    this.llm = (llmFactory ?? createDefaultLlmFactoryService()).createChatModel(
      {
        modelEnvKeys: ['QUERY_REWRITE_MODEL_NAME'],
        defaultModel: DEFAULT_LLM_MODEL_NAME,
        temperature: 0,
      },
    );
  }

  async rewrite(
    query: string,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    const normalizedQuery = query.trim();
    throwIfAborted(signal);

    if (!normalizedQuery) {
      return this.buildFallbackRewrite('', '原始问题为空，跳过改写');
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
          if (isAbortError(error)) {
            throw error;
          }

          this.logger.warn(
            `Query Rewrite 失败，回退原问题：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.buildFallbackRewrite(
            normalizedQuery,
            '改写失败，已回退原问题',
          );
        }
      },
    );
  }

  buildFallbackRewrite(
    query: string,
    reason: string,
  ): KnowledgeQueryRewriteResult {
    const fallbackKeywords = this.normalizeKeywords([], query);
    return {
      originalQuery: query,
      rewrittenQuery: query,
      keywords: fallbackKeywords,
      expandedQueries: query
        ? [
            {
              index: 0,
              query,
              keywords: fallbackKeywords,
              angle: 'original',
            },
          ]
        : [],
      changed: false,
      reason,
    };
  }

  resolveRetrievalQueries(
    rewrite: KnowledgeQueryRewriteResult,
    maxQueries: number,
    options: {
      useMultiQuery?: boolean;
      preferOriginal?: boolean;
    } = {},
  ): RetrievalQueryItem[] {
    const useMultiQuery = options.useMultiQuery ?? true;
    const preferOriginal = options.preferOriginal ?? false;

    const seen = new Set<string>();
    const queries: RetrievalQueryItem[] = [];

    const pushQuery = (
      queryText: string,
      keywords: string[],
      angle: RetrievalQueryItem['angle'],
    ) => {
      const q = queryText.trim();
      if (!q || queries.length >= maxQueries) {
        return;
      }
      const key = q.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      queries.push({
        index: queries.length,
        query: q,
        keywords,
        angle,
      });
    };

    if (!useMultiQuery) {
      // 单路检索模式
      if (preferOriginal && rewrite.originalQuery) {
        pushQuery(
          rewrite.originalQuery,
          this.normalizeKeywords(rewrite.keywords, rewrite.originalQuery),
          'original',
        );
      } else if (rewrite.rewrittenQuery) {
        pushQuery(
          rewrite.rewrittenQuery,
          this.normalizeKeywords(rewrite.keywords, rewrite.rewrittenQuery),
          rewrite.rewrittenQuery === rewrite.originalQuery ? 'original' : 'semantic',
        );
      }
    } else {
      // 多路检索模式
      if (preferOriginal) {
        // Agent 模式，首位塞 originalQuery，次位塞 rewrittenQuery
        if (rewrite.originalQuery) {
          pushQuery(
            rewrite.originalQuery,
            this.normalizeKeywords(rewrite.keywords, rewrite.originalQuery),
            'original',
          );
        }
        if (rewrite.rewrittenQuery) {
          pushQuery(
            rewrite.rewrittenQuery,
            this.normalizeKeywords(rewrite.keywords, rewrite.rewrittenQuery),
            rewrite.rewrittenQuery === rewrite.originalQuery ? 'original' : 'semantic',
          );
        }
        for (const item of rewrite.expandedQueries ?? []) {
          pushQuery(
            item.query,
            this.normalizeKeywords(item.keywords ?? [], item.query),
            item.angle ?? 'semantic',
          );
        }
      } else {
        // API 检索模式，若有 expandedQueries 则直用
        if ((rewrite.expandedQueries?.length ?? 0) > 0) {
          for (const item of rewrite.expandedQueries!) {
            pushQuery(
              item.query,
              this.normalizeKeywords(item.keywords ?? [], item.query),
              item.angle ?? 'semantic',
            );
          }
        } else if (rewrite.rewrittenQuery) {
          pushQuery(
            rewrite.rewrittenQuery,
            this.normalizeKeywords(rewrite.keywords, rewrite.rewrittenQuery),
            rewrite.rewrittenQuery === rewrite.originalQuery ? 'original' : 'semantic',
          );
        }
      }
    }

    // 兜底保护
    if (queries.length === 0 && rewrite.originalQuery) {
      pushQuery(
        rewrite.originalQuery,
        this.normalizeKeywords(rewrite.keywords, rewrite.originalQuery),
        'original',
      );
    }

    return queries;
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
    const items: Array<{ query: string; keywords?: any; angle?: RetrievalQueryAngle }> = [];

    if (rewrittenQuery.trim()) {
      items.push({
        query: rewrittenQuery,
        keywords,
        angle: 'original' as RetrievalQueryAngle,
      });
    }

    items.push(...expandedQueries);

    const normalizedItems = items
      .map((item) => ({
        query: item.query.trim(),
        keywords: this.normalizeKeywords(item.keywords ?? [], item.query),
        angle: (item.angle ?? 'semantic') as RetrievalQueryAngle,
      }))
      .filter((item) => {
        if (!item.query) return false;
        const key = item.query.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return this.padExpandedQueries(
      normalizedItems,
      rewrittenQuery,
      keywords,
      3,
    )
      .slice(0, 3)
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

}
