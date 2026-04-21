import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { throwIfAborted } from '@/agent/agent.utils';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  buildMultiHopPlannerPromptInput,
  MULTI_HOP_PLANNER_PROMPT,
} from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import type { RagMultiHopPlan } from '@/agent/rag-workflow.types';

const MultiHopPlanSchema = z.object({
  subQuestions: z.array(z.string().min(1).max(300)).min(1).max(6),
  reason: z.string().min(1).max(200),
});

@Injectable()
export class MultiHopPlannerService {
  private readonly logger = new Logger(MultiHopPlannerService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.MULTI_HOP_PLANNER_MODEL_NAME ??
      process.env.MODEL_NAME ??
      DEFAULT_LLM_MODEL_NAME,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async planSubQuestions(
    question: string,
    signal?: AbortSignal,
  ): Promise<RagMultiHopPlan> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      return {
        subQuestions: [],
        reason: '问题为空，跳过多跳规划',
      };
    }

    return runInTracedScope(
      {
        name: 'rag_plan_sub_questions',
        runType: 'chain',
        tags: ['agent', 'rag', 'multi-hop', 'plan'],
        metadata: {
          questionLength: normalizedQuestion.length,
        },
        input: {
          question: normalizedQuestion,
        },
        outputProcessor: (output) => ({
          subQuestionCount: output.subQuestions.length,
          reason: output.reason,
        }),
      },
      async () => {
        throwIfAborted(signal);

        try {
          const planner = this.llm.withStructuredOutput(MultiHopPlanSchema);
          const result = await planner.invoke(
            await MULTI_HOP_PLANNER_PROMPT.formatMessages(
              buildMultiHopPlannerPromptInput(normalizedQuestion),
            ),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'rag_plan_sub_questions_llm',
                tags: ['agent', 'rag', 'multi-hop', 'plan', 'llm'],
                metadata: {
                  question: normalizedQuestion,
                },
              }),
              signal,
            },
          );

          const subQuestions = this.normalizeSubQuestions(
            result.subQuestions,
            normalizedQuestion,
          );

          return {
            subQuestions,
            reason: result.reason.trim() || '多跳规划完成',
          } satisfies RagMultiHopPlan;
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }
          this.logger.warn(
            `多跳规划失败，回退原问题：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.buildFallbackPlan(normalizedQuestion);
        }
      },
    );
  }

  private normalizeSubQuestions(
    subQuestions: string[],
    originalQuestion: string,
  ): string[] {
    const normalized = Array.from(
      new Set(
        subQuestions
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ).slice(0, 6);

    return normalized.length > 0 ? normalized : [originalQuestion];
  }

  private buildFallbackPlan(question: string): RagMultiHopPlan {
    return {
      subQuestions: [question],
      reason: '规划失败，暂时回退为原问题单条规划',
    };
  }
}
