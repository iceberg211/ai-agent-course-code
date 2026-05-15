import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { throwIfAborted } from '@/agent/agent.utils';
import { normalizeRetrievalStrategy } from '@/agent/retrieval-strategy.utils';
import type {
  RagRetrievalStrategyDecision,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  buildRagRetrievalStrategyPromptInput,
  RAG_RETRIEVAL_STRATEGY_PROMPT,
} from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';

const RetrievalStrategySchema = z.object({
  needRetrieval: z.boolean(),
  useVector: z.boolean(),
  useKeyword: z.boolean(),
  useGraph: z.boolean().default(false),
  useExactPhrase: z.boolean().default(false),
  useMultiQuery: z.boolean().default(true),
  useHyDE: z.boolean().default(false),
  allowWeb: z.boolean().default(true),
  queryCount: z.number().int().min(1).max(5).optional(),
  chunkContextWindow: z.number().int().min(0).max(2).default(0),
  parentContext: z.boolean().default(false),
  parentContextMaxChars: z.number().int().min(500).max(4000).default(2000),
  contextCompression: z.boolean().default(false),
  lostInMiddle: z.boolean().default(true),
  reason: z.string().min(1).max(240),
});

@Injectable()
export class RetrievalStrategyService {
  private readonly logger = new Logger(RetrievalStrategyService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.RETRIEVAL_STRATEGY_MODEL_NAME ??
      process.env.MODEL_NAME ??
      DEFAULT_LLM_MODEL_NAME,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async plan(
    input: {
      question: string;
      currentQuery: string;
      routeStrategy: RagStrategy;
      remainingHops: number;
    },
    signal?: AbortSignal,
  ): Promise<RagRetrievalStrategyDecision> {
    const normalizedQuestion = input.question.trim();
    const normalizedQuery = input.currentQuery.trim() || normalizedQuestion;

    return runInTracedScope(
      {
        name: 'rag_retrieval_strategy',
        runType: 'chain',
        tags: ['agent', 'rag', 'retrieval-strategy'],
        input: {
          question: normalizedQuestion,
          currentQuery: normalizedQuery,
          routeStrategy: input.routeStrategy,
          remainingHops: input.remainingHops,
        },
        outputProcessor: (output) => ({
          needRetrieval: output.needRetrieval,
          useVector: output.useVector,
          useKeyword: output.useKeyword,
          useExactPhrase: output.useExactPhrase,
          useMultiQuery: output.useMultiQuery,
          useHyDE: output.useHyDE,
          chunkContextWindow: output.chunkContextWindow,
          parentContext: output.parentContext,
          parentContextMaxChars: output.parentContextMaxChars,
          allowWeb: output.allowWeb,
          reason: output.reason,
        }),
      },
      async () => {
        throwIfAborted(signal);

        try {
          const planner = this.llm.withStructuredOutput(
            RetrievalStrategySchema,
          );
          const result = await planner.invoke(
            await RAG_RETRIEVAL_STRATEGY_PROMPT.formatMessages(
              buildRagRetrievalStrategyPromptInput({
                question: normalizedQuestion,
                currentQuery: normalizedQuery,
                routeStrategy: input.routeStrategy,
                remainingHops: input.remainingHops,
              }),
            ),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'rag_retrieval_strategy_llm',
                tags: ['agent', 'rag', 'retrieval-strategy', 'llm'],
                metadata: {
                  question: normalizedQuestion,
                  currentQuery: normalizedQuery,
                },
              }),
              signal,
            },
          );

          return normalizeRetrievalStrategy(result);
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }
          this.logger.warn(
            `检索策略规划失败，回退启发式策略：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.buildFallbackStrategy(normalizedQuery);
        }
      },
    );
  }

  private buildFallbackStrategy(query: string): RagRetrievalStrategyDecision {
    const normalized = query.replace(/\s+/g, '');
    const isGreeting = /^(你好|您好|嗨|hi|hello|哈喽|谢谢|多谢)[。！!？?]*$/iu.test(
      normalized,
    );
    if (isGreeting) {
      return normalizeRetrievalStrategy({
        needRetrieval: false,
        useVector: false,
        useKeyword: false,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: false,
        useHyDE: false,
        allowWeb: false,
        chunkContextWindow: 0,
        parentContext: false,
        lostInMiddle: false,
        reason: '寒暄或礼貌表达，不需要查知识库',
      });
    }

    const exactLike =
      /《|》|"|'|\.md|\.txt|编号|订单|合同|条款|第.+章|第.+条/u.test(query);
    const graphLike =
      exactLike || /关系|关联|参与方|甲方|乙方|主体|事件|流程|上下游/u.test(query);

    return normalizeRetrievalStrategy({
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: graphLike,
      graphMode: graphLike ? 'path' : undefined,
      graphMaxHops: graphLike ? 2 : undefined,
      useExactPhrase: exactLike,
      useMultiQuery: true,
      useHyDE: false,
      allowWeb: true,
      queryCount: exactLike ? 2 : 3,
      chunkContextWindow: 0,
      parentContext: false,
      parentContextMaxChars: 2000,
      contextCompression: false,
      lostInMiddle: true,
      reason: exactLike
        ? '问题包含明确实体或短语，启用短语加权和混合检索'
        : '问题需要知识库事实，启用多查询混合检索',
    });
  }
}
