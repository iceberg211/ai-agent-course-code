import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import {
  DEFAULT_EMBEDDINGS_MODEL_NAME,
  DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG,
  SUPABASE_CLIENT,
} from '@/common/constants';
import type { RetrieveKnowledgeOptions } from '@/knowledge-content/types/knowledge-content.types';

@Injectable()
export class KnowledgeContentRuntimeService {
  private readonly logger = new Logger(KnowledgeContentRuntimeService.name);

  readonly embeddingBatchSize = this.toBoundedNumber(
    process.env.EMBEDDINGS_BATCH_SIZE,
    10,
    1,
    10,
  );

  readonly embeddings = new OpenAIEmbeddings({
    model: process.env.EMBEDDINGS_MODEL_NAME ?? DEFAULT_EMBEDDINGS_MODEL_NAME,
    batchSize: this.embeddingBatchSize,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ['\n\n', '\n', '。', '！', '？', '；', '，', ' '],
  });

  constructor(
    @Inject(SUPABASE_CLIENT)
    readonly supabase: SupabaseClient,
  ) {}

  normalizeRetrieveOptions(
    options: RetrieveKnowledgeOptions,
  ): Required<RetrieveKnowledgeOptions> {
    const finalTopK = this.toBoundedNumber(
      options.finalTopK,
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.finalTopK,
      1,
      20,
    );
    const rerank = options.rerank !== false;
    const stage1Default = rerank ? Math.max(20, finalTopK) : finalTopK;
    const stage1TopK = this.toBoundedNumber(
      options.stage1TopK,
      stage1Default,
      finalTopK,
      50,
    );
    const threshold = this.toBoundedNumber(
      options.threshold,
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.threshold,
      0,
      1,
    );

    return {
      threshold,
      rerank,
      stage1TopK,
      finalTopK,
    };
  }

  toBoundedNumber(
    raw: unknown,
    defaultValue: number,
    min: number,
    max: number,
  ): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return defaultValue;
    return Math.min(max, Math.max(min, value));
  }

  async withTransientRetry<T>(
    operation: string,
    fn: () => Promise<T>,
    attempts = 2,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isTransientError(error) || attempt === attempts) {
          break;
        }
        this.logger.warn(
          `${operation} 第 ${attempt} 次失败，准备重试：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }

    throw lastError;
  }

  private isTransientError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';

    return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|502|503|504|429/i.test(
      message,
    );
  }
}
