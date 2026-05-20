import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import { buildLangSmithRunnableConfig } from '@/common/langsmith/langsmith.utils';
import {
  createDefaultLlmFactoryService,
  LlmFactoryService,
} from '@/common/llm/llm-factory.service';
import {
  buildKnowledgeRerankPromptInput,
  KNOWLEDGE_RERANK_PROMPT,
} from '@/common/prompts';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

interface RerankerItem {
  index: number;
  score: number;
}

const RerankResultSchema = z.object({
  scores: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      score: z.number(),
    }),
  ),
});

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly model: string;
  private readonly llm: ChatOpenAI;

  constructor(@Optional() llmFactory?: LlmFactoryService) {
    const factory = llmFactory ?? createDefaultLlmFactoryService();
    this.model = factory.resolveModel({
      modelEnvKeys: ['RERANKER_MODEL_NAME'],
      defaultModel: DEFAULT_LLM_MODEL_NAME,
    });
    this.llm = factory.createChatModel({
      model: this.model,
      temperature: 0,
    });
  }

  async rerank(
    query: string,
    candidates: KnowledgeChunk[],
    topK = 5,
    signal?: AbortSignal,
  ): Promise<KnowledgeChunk[]> {
    throwIfAborted(signal);

    if (!candidates.length || topK <= 0) {
      return [];
    }

    const safeTopK = Math.min(Math.max(topK, 1), candidates.length);
    try {
      const rewriter = this.llm.withStructuredOutput(RerankResultSchema);
      const result = await rewriter.invoke(
        await KNOWLEDGE_RERANK_PROMPT.formatMessages(
          buildKnowledgeRerankPromptInput(query, candidates),
        ),
        {
          ...buildLangSmithRunnableConfig({
            runName: 'knowledge_rerank_llm',
            tags: ['knowledge', 'rag', 'rerank', 'llm'],
            metadata: {
              query,
              candidateCount: candidates.length,
              topK: safeTopK,
            },
          }),
          signal,
        },
      );

      throwIfAborted(signal);

      const parsed = result?.scores ?? [];
      return this.applyScores(candidates, parsed, safeTopK);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(
        `LLM Rerank 失败，保留原有排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return candidates.slice(0, safeTopK);
  }

  private applyScores(
    candidates: KnowledgeChunk[],
    parsed: RerankerItem[],
    safeTopK: number,
  ): KnowledgeChunk[] {
    const scoreMap = new Map<number, number>();

    for (const item of parsed) {
      if (
        Number.isInteger(item.index) &&
        item.index >= 0 &&
        item.index < candidates.length &&
        Number.isFinite(item.score)
      ) {
        scoreMap.set(item.index, item.score);
      }
    }

    const reranked = candidates.map((chunk, index) => ({
      ...chunk,
      rerank_score: scoreMap.get(index) ?? 0,
    }));

    reranked.sort((a, b) => {
      const scoreDiff = (b.rerank_score ?? 0) - (a.rerank_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.similarity ?? 0) - (a.similarity ?? 0);
    });

    return reranked.slice(0, safeTopK);
  }
}
