import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { throwIfAborted } from '@/agent/agent.utils';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import { buildRagRoutePromptInput, RAG_ROUTE_PROMPT } from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import type {
  RagRouteDecision,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';

const RagRouteSchema = z.object({
  strategy: z.enum(['simple', 'complex']),
  reason: z.string().min(1).max(200),
});

@Injectable()
export class RagRouteService {
  private readonly logger = new Logger(RagRouteService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.RAG_ROUTE_MODEL_NAME ??
      process.env.MODEL_NAME ??
      DEFAULT_LLM_MODEL_NAME,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async routeQuestion(
    question: string,
    signal?: AbortSignal,
  ): Promise<RagRouteDecision> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      return {
        strategy: 'simple',
        reason: '问题为空，默认按 simple 处理',
      };
    }

    return runInTracedScope(
      {
        name: 'rag_route_question',
        runType: 'chain',
        tags: ['agent', 'rag', 'route'],
        metadata: {
          questionLength: normalizedQuestion.length,
        },
        input: {
          question: normalizedQuestion,
        },
        outputProcessor: (output) => ({
          strategy: output.strategy,
          reason: output.reason,
        }),
      },
      async () => {
        throwIfAborted(signal);

        try {
          const router = this.llm.withStructuredOutput(RagRouteSchema);
          const result = await router.invoke(
            await RAG_ROUTE_PROMPT.formatMessages(
              buildRagRoutePromptInput(normalizedQuestion),
            ),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'rag_route_llm',
                tags: ['agent', 'rag', 'route', 'llm'],
                metadata: {
                  question: normalizedQuestion,
                },
              }),
              signal,
            },
          );

          return {
            strategy: result.strategy,
            reason: result.reason.trim() || '路由完成',
          } satisfies RagRouteDecision;
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }
          this.logger.warn(
            `问题路由失败，回退启发式判断：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.buildFallbackDecision(normalizedQuestion);
        }
      },
    );
  }

  private buildFallbackDecision(question: string): RagRouteDecision {
    const normalized = question.replace(/\s+/g, '');
    const complexPatterns = [
      /先.*再/u,
      /然后/u,
      /以及/u,
      /并且/u,
      /分别/u,
      /对比/u,
      /关系/u,
      /原因/u,
      /为什么/u,
      /如何/u,
      /后来/u,
      /最终/u,
      /结局/u,
      /第几[集章节]/u,
    ];
    const hitCount = complexPatterns.filter((pattern) =>
      pattern.test(normalized),
    ).length;
    const strategy: RagStrategy =
      hitCount >= 2 || normalized.length >= 28 ? 'complex' : 'simple';

    return {
      strategy,
      reason:
        strategy === 'complex'
          ? '启发式判断为多事实或多步骤问题'
          : '启发式判断为直接问题',
    };
  }
}
