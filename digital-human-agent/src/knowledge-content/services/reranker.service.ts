import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import { buildLangSmithRunnableConfig } from '@/common/langsmith/langsmith.utils';
import {
  buildKnowledgeRerankPromptInput,
  KNOWLEDGE_RERANK_PROMPT,
} from '@/common/prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

interface RerankItem {
  index: number;
  score: number;
}

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.RERANKER_MODEL_NAME ??
      process.env.MODEL_NAME ??
      DEFAULT_LLM_MODEL_NAME,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async rerank(
    query: string,
    candidates: KnowledgeChunk[],
    topK = 5,
  ): Promise<KnowledgeChunk[]> {
    if (!candidates.length || topK <= 0) {
      return [];
    }

    const safeTopK = Math.min(Math.max(topK, 1), candidates.length);
    const response = await this.llm.invoke(
      await KNOWLEDGE_RERANK_PROMPT.formatMessages(
        buildKnowledgeRerankPromptInput(query, candidates),
      ),
      buildLangSmithRunnableConfig({
        runName: 'knowledge_rerank_llm',
        tags: ['knowledge', 'rag', 'rerank', 'llm'],
        metadata: {
          query,
          candidateCount: candidates.length,
          topK: safeTopK,
        },
      }),
    );

    const raw = this.extractText(response.content);
    const parsed = this.parseRerankItems(raw);
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

    const joined = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('\n');
    return joined.trim();
  }

  private parseRerankItems(raw: string): RerankItem[] {
    const normalized = raw.trim();
    if (!normalized) {
      this.logger.warn('Reranker 返回空内容，按无重排处理');
      return [];
    }

    const direct = this.tryParseArray(normalized);
    if (direct) return direct;

    const match = normalized.match(/\[[\s\S]*\]/);
    if (match) {
      const extracted = this.tryParseArray(match[0]);
      if (extracted) return extracted;
    }

    throw new Error(`Reranker 输出不是合法 JSON：${normalized.slice(0, 180)}`);
  }

  private tryParseArray(raw: string): RerankItem[] | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            index: Number((item as { index?: unknown }).index),
            score: Number((item as { score?: unknown }).score),
          }))
          .filter(
            (item) =>
              Number.isInteger(item.index) && Number.isFinite(item.score),
          );
      }

      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { scores?: unknown }).scores)
      ) {
        const scores = (parsed as { scores: unknown[] }).scores;
        return scores
          .map((item) => ({
            index: Number((item as { index?: unknown }).index),
            score: Number((item as { score?: unknown }).score),
          }))
          .filter(
            (item) =>
              Number.isInteger(item.index) && Number.isFinite(item.score),
          );
      }
    } catch {
      return null;
    }
    return null;
  }
}
