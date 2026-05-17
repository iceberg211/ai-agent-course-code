import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AIMessage } from '@langchain/core/messages';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  createDefaultLlmFactoryService,
  LlmFactoryService,
} from '@/common/llm/llm-factory.service';
import {
  buildKnowledgeContextualRetrievalPromptInput,
  KNOWLEDGE_CONTEXTUAL_RETRIEVAL_PROMPT,
} from '@/common/prompts';
import { readBooleanEnv } from '@/common/utils';
import type { KnowledgeDocumentChunk } from '@/knowledge-content/services/knowledge-document-chunking.service';

export const KNOWLEDGE_CONTEXTUAL_RETRIEVAL_LLM =
  'KNOWLEDGE_CONTEXTUAL_RETRIEVAL_LLM';

interface ContextualRetrievalLlm {
  invoke(input: unknown): Promise<unknown>;
}

interface EnrichChunksInput {
  filename: string;
  documentContent: string;
  chunks: KnowledgeDocumentChunk[];
}

@Injectable()
export class KnowledgeContextualRetrievalService {
  private readonly logger = new Logger(
    KnowledgeContextualRetrievalService.name,
  );
  private readonly llm: ContextualRetrievalLlm;

  constructor(
    @Optional()
    @Inject(KNOWLEDGE_CONTEXTUAL_RETRIEVAL_LLM)
    llm?: ContextualRetrievalLlm,
    @Optional()
    llmFactory?: LlmFactoryService,
  ) {
    this.llm =
      llm ??
      (llmFactory ?? createDefaultLlmFactoryService()).createChatModel({
        modelEnvKeys: ['CONTEXTUAL_RETRIEVAL_MODEL_NAME'],
        defaultModel: DEFAULT_LLM_MODEL_NAME,
        temperature: 0,
      });
  }

  async enrichChunks(
    input: EnrichChunksInput,
  ): Promise<KnowledgeDocumentChunk[]> {
    if (!this.isEnabled() || input.chunks.length === 0) {
      return input.chunks;
    }

    const enriched: KnowledgeDocumentChunk[] = [];
    for (const chunk of input.chunks) {
      enriched.push(await this.enrichOne(input, chunk));
    }
    return enriched;
  }

  private async enrichOne(
    input: EnrichChunksInput,
    chunk: KnowledgeDocumentChunk,
  ): Promise<KnowledgeDocumentChunk> {
    try {
      const messages =
        await KNOWLEDGE_CONTEXTUAL_RETRIEVAL_PROMPT.formatMessages(
          buildKnowledgeContextualRetrievalPromptInput({
            filename: input.filename,
            documentContent: input.documentContent,
            chunkContent: chunk.pageContent,
          }),
        );
      const response = await this.llm.invoke(messages);
      const context = this.normalizeContext(this.extractText(response));
      if (!context) return chunk;

      return {
        ...chunk,
        pageContent: `[文档上下文] ${context}\n${chunk.pageContent}`,
      };
    } catch (error) {
      this.logger.warn(
        `Contextual Retrieval 生成失败，保留原 chunk：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return chunk;
    }
  }

  private isEnabled(): boolean {
    return readBooleanEnv(process.env, 'ENABLE_CONTEXTUAL_RETRIEVAL');
  }

  private normalizeContext(value: string): string {
    return value
      .replace(/[`"'“”‘’]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  private extractText(response: unknown): string {
    if (response instanceof AIMessage) {
      return this.extractText(response.content);
    }
    if (typeof response === 'string') return response;
    if (!response || typeof response !== 'object') return '';

    const content = (response as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('\n');
  }
}
