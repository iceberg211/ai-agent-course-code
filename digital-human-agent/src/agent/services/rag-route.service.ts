import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  createDefaultLlmFactoryService,
  LlmFactoryService,
} from '@/common/llm/llm-factory.service';
import { buildRagRoutePromptInput, RAG_ROUTE_PROMPT } from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import type {
  RagRouteDecision,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';
import {
  addTurnDegradation,
  tryConsumeLlmBudget,
} from '@/common/rag/turn-budget.context';

const RagRouteSchema = z.object({
  strategy: z.enum(['simple', 'complex', 'none']),
  reason: z.string().min(1).max(200),
});

@Injectable()
export class RagRouteService {
  private readonly logger = new Logger(RagRouteService.name);

  private readonly llm: ChatOpenAI;

  private static readonly CHAT_PATTERNS = [
    /^(?:你好|您好|哈喽|hello|hi|hey|在吗|早上好|中午好|下午好|晚上好)$/i,
    /^(?:谢谢|非常感谢|拜拜|再见|再会|晚安)$/i,
  ];

  private static readonly MULTI_STEP_PATTERNS = [
    /先.*再/u,
    /然后/u,
    /以及/u,
    /并且/u,
    /分别/u,
    /对比/u,
    /原因/u,
    /为什么/u,
    /如何/u,
    /后来/u,
    /最终/u,
    /结局/u,
    /第几[集章节]/u,
  ];

  constructor(@Optional() llmFactory?: LlmFactoryService) {
    this.llm = (llmFactory ?? createDefaultLlmFactoryService()).createChatModel(
      {
        modelEnvKeys: ['RAG_ROUTE_MODEL_NAME'],
        defaultModel: DEFAULT_LLM_MODEL_NAME,
        temperature: 0,
      },
    );
  }

  async routeQuestion(
    question: string,
    signal?: AbortSignal,
  ): Promise<RagRouteDecision> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      return {
        strategy: 'none',
        reason: '问题为空，默认按 none 处理',
      };
    }

    if (
      RagRouteService.CHAT_PATTERNS.some((pattern) =>
        pattern.test(normalizedQuestion.replace(/\s+/g, '')),
      )
    ) {
      return {
        strategy: 'none',
        reason: '命中快捷闲聊特征，无需检索',
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

        if (!tryConsumeLlmBudget(1)) {
          addTurnDegradation('route_heuristic');
          return this.buildFallbackDecision(normalizedQuestion);
        }

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
          if (isAbortError(error)) {
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
    if (RagRouteService.CHAT_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        strategy: 'none',
        reason: '启发式判断为普通问候或告别',
      };
    }

    const directRelationQuestion =
      /(?:和|与).{1,80}(?:是什么关系|的关系是什么|包含子主题关系是什么|关联关系是什么)/u.test(
        normalized,
      ) && !RagRouteService.MULTI_STEP_PATTERNS.some((pattern) => pattern.test(normalized));

    if (directRelationQuestion) {
      return {
        strategy: 'simple',
        reason: '启发式判断为直接实体关系问题',
      };
    }

    const complexPatterns = [...RagRouteService.MULTI_STEP_PATTERNS, /关系/u];
    const hitCount = complexPatterns.filter((pattern) =>
      pattern.test(normalized),
    ).length;
    // 提高 complex 阈值，避免普通中长句被过度拆 hop 导致延迟与费用上升
    const strategy: RagStrategy =
      hitCount >= 2 || (hitCount >= 1 && normalized.length >= 40)
        ? 'complex'
        : 'simple';

    return {
      strategy,
      reason:
        strategy === 'complex'
          ? '启发式判断为多事实或多步骤问题'
          : '启发式判断为直接问题',
    };
  }
}
