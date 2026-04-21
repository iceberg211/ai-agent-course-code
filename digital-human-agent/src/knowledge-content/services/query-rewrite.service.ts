import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  buildKnowledgeQueryRewritePromptInput,
  KNOWLEDGE_QUERY_REWRITE_PROMPT,
} from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import type { KnowledgeQueryRewriteResult } from '@/knowledge-content/types/knowledge-content.types';

const KnowledgeQueryRewriteSchema = z.object({
  rewrittenQuery: z.string().min(1).max(500),
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

  async rewrite(query: string): Promise<KnowledgeQueryRewriteResult> {
    const normalizedQuery = query.trim();
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
          changed: output.changed,
          reason: output.reason,
        }),
      },
      async () => {
        try {
          const rewriter = this.llm.withStructuredOutput(
            KnowledgeQueryRewriteSchema,
          );
          const result = await rewriter.invoke(
            await KNOWLEDGE_QUERY_REWRITE_PROMPT.formatMessages(
              buildKnowledgeQueryRewritePromptInput(normalizedQuery),
            ),
            buildLangSmithRunnableConfig({
              runName: 'knowledge_query_rewrite_llm',
              tags: ['knowledge', 'rag', 'rewrite', 'llm'],
              metadata: {
                originalQuery: normalizedQuery,
              },
            }),
          );

          const rewrittenQuery =
            result.rewrittenQuery.trim() || normalizedQuery;
          return {
            originalQuery: normalizedQuery,
            rewrittenQuery,
            changed: rewrittenQuery !== normalizedQuery,
            reason: result.reason.trim() || '改写完成',
          };
        } catch (error) {
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
    return {
      originalQuery: query,
      rewrittenQuery: query,
      changed: false,
      reason,
    };
  }
}
