import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import {
  DEFAULT_EMBEDDINGS_MODEL_NAME,
  DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG,
  SUPABASE_CLIENT,
  DEFAULT_KNOWLEDGE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_CHUNK_OVERLAP,
  DEFAULT_EMBEDDINGS_BATCH_SIZE_DEFAULT,
  RETRIEVAL_LIMIT_MAX,
  RERANK_LIMIT_MIN,
  RERANK_LIMIT_MAX,
  THRESHOLD_MIN,
  THRESHOLD_MAX,
} from '@/common/constants';
import {
  formatErrorMessage,
  isTransientInfrastructureError,
  withRetry,
} from '@/common/utils';
import type {
  NormalizedRetrieveKnowledgeOptions,
  RetrieveKnowledgeOptions,
} from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class RagRuntimeService {
  private readonly logger = new Logger(RagRuntimeService.name);

  readonly embeddingBatchSize: number;
  readonly embeddings: OpenAIEmbeddings;

  readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: DEFAULT_KNOWLEDGE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_CHUNK_OVERLAP,
    separators: ['\n\n', '\n', '。', '！', '？', '；', '，', ' '],
  });

  constructor(
    @Inject(SUPABASE_CLIENT)
    readonly supabase: SupabaseClient,
    private readonly configService: ConfigService,
  ) {
    this.embeddingBatchSize = this.toBoundedNumber(
      this.configService.get<string>('EMBEDDINGS_BATCH_SIZE'),
      DEFAULT_EMBEDDINGS_BATCH_SIZE_DEFAULT,
      1,
      DEFAULT_EMBEDDINGS_BATCH_SIZE_DEFAULT,
    );

    this.embeddings = new OpenAIEmbeddings({
      model:
        this.configService.get<string>('EMBEDDINGS_MODEL_NAME') ??
        DEFAULT_EMBEDDINGS_MODEL_NAME,
      batchSize: this.embeddingBatchSize,
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
        apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      },
    });
  }

  normalizeRetrieveOptions(
    options: RetrieveKnowledgeOptions,
  ): NormalizedRetrieveKnowledgeOptions {
    const rawRerankLimit = options.rerankLimit ?? options.finalTopK;
    const rerankLimit = this.toBoundedNumber(
      rawRerankLimit,
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
      RERANK_LIMIT_MIN,
      RERANK_LIMIT_MAX,
    );
    const rerank = options.rerank !== false;
    const retrievalDefault = rerank ? Math.max(20, rerankLimit) : rerankLimit;

    const rawRetrievalLimit = options.retrievalLimit ?? options.stage1TopK;
    const retrievalLimit = this.toBoundedNumber(
      rawRetrievalLimit,
      retrievalDefault,
      rerankLimit,
      RETRIEVAL_LIMIT_MAX,
    );
    const threshold = this.toBoundedNumber(
      options.threshold,
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.threshold,
      THRESHOLD_MIN,
      THRESHOLD_MAX,
    );
    return {
      threshold,
      rerank,
      retrievalLimit,
      rerankLimit,
      skipQueryRewrite: options.skipQueryRewrite === true,
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
    return withRetry(operation, fn, {
      attempts,
      initialDelayMs: 200,
      maxDelayMs: 1000,
      logger: this.logger,
      shouldRetry: isTransientInfrastructureError,
      formatRetryMessage: ({ operation: op, attempt, error }) =>
        `${op} 第 ${attempt} 次失败，准备重试：${formatErrorMessage(error)}`,
    });
  }
}
