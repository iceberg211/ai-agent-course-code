import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
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
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';
import {
  KnowledgeQueryRewriteSchema,
  normalizeExpandedQueries,
  normalizeKeywords,
  resolveRetrievalQueries,
} from './query-rewrite-utils';

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
          const keywords = normalizeKeywords(
            result.keywords,
            normalizedQuery,
          );
          const expandedQueries = normalizeExpandedQueries(
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
    const fallbackKeywords = normalizeKeywords([], query);
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
    return resolveRetrievalQueries(rewrite, maxQueries, options);
  }
}
