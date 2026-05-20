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
import { extractFallbackKeywordTerms } from '@/knowledge-content/services/knowledge-keyword-retriever.service';
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryAngle,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';
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
          if (isAbortError(error)) {
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

  private buildFallbackResult(
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

    return items
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
      .slice(0, 3)
      .map((item, index) => ({
        index,
        ...item,
      }));
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
