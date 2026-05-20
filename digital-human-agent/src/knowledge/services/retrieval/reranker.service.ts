import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
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
      const response = await this.llm.invoke(
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

      const parsed = this.parseRerankItems(this.extractText(response.content));
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

  private parseRerankItems(raw: string): RerankerItem[] {
    const normalized = raw.trim();
    if (!normalized) {
      this.logger.warn('Reranker 返回空内容，按无重排处理');
      return [];
    }

    const direct = this.tryParseItems(normalized);
    if (direct) return direct;

    const match = normalized.match(/\[[\s\S]*\]/);
    if (match) {
      const extracted = this.tryParseItems(match[0]);
      if (extracted) return extracted;
    }

    throw new Error(`Reranker 输出不是合法 JSON：${normalized.slice(0, 180)}`);
  }

  private tryParseItems(raw: string): RerankerItem[] | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { scores?: unknown }).scores)
          ? (parsed as { scores: unknown[] }).scores
          : null;

      if (!list) return null;

      return list
        .map((item) => ({
          index: Number((item as { index?: unknown }).index),
          score: Number((item as { score?: unknown }).score),
        }))
        .filter(
          (item) => Number.isInteger(item.index) && Number.isFinite(item.score),
        );
    } catch {
      return null;
    }
  }
}
