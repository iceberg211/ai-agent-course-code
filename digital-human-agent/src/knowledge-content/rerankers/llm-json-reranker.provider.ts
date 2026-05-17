import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { throwIfAborted } from '@/agent/agent.utils';
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
import type {
  RerankerProvider,
  RerankerProviderInput,
  RerankerProviderItem,
} from '@/knowledge-content/rerankers/reranker-provider.interface';

@Injectable()
export class LlmJsonRerankerProvider implements RerankerProvider {
  private readonly logger = new Logger(LlmJsonRerankerProvider.name);
  readonly name = 'llm-json';
  readonly model: string;

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

  async rerank(input: RerankerProviderInput): Promise<RerankerProviderItem[]> {
    throwIfAborted(input.signal);

    const response = await this.llm.invoke(
      await KNOWLEDGE_RERANK_PROMPT.formatMessages(
        buildKnowledgeRerankPromptInput(input.query, input.candidates),
      ),
      {
        ...buildLangSmithRunnableConfig({
          runName: 'knowledge_rerank_llm',
          tags: ['knowledge', 'rag', 'rerank', 'llm'],
          metadata: {
            query: input.query,
            candidateCount: input.candidates.length,
            topK: input.topK,
          },
        }),
        signal: input.signal,
      },
    );

    throwIfAborted(input.signal);

    return this.parseRerankItems(this.extractText(response.content));
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

  private parseRerankItems(raw: string): RerankerProviderItem[] {
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

  private tryParseItems(raw: string): RerankerProviderItem[] | null {
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
