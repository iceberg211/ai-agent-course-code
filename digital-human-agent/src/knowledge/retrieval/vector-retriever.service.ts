import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import type { KnowledgeChunk } from './domain/retrieval.types';

@Injectable()
export class VectorRetrieverService {
  private readonly logger = new Logger(VectorRetrieverService.name);

  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async retrieve(
    kbId: string,
    queryEmbedding: number[],
    threshold: number,
    topK: number,
  ): Promise<KnowledgeChunk[]> {
    if (!queryEmbedding.length || topK <= 0) return [];

    const { data, error } = await this.withTransientRetry<{
      data: KnowledgeChunk[] | null;
      error: { message: string } | null;
    }>(
      'match_knowledge rpc',
      async () => {
        const result = await this.supabase.rpc('match_knowledge', {
          query_embedding: queryEmbedding,
          p_kb_id: kbId,
          match_threshold: threshold,
          match_count: topK,
        });
        return {
          data: (result.data as KnowledgeChunk[] | null) ?? null,
          error: result.error ? { message: result.error.message } : null,
        };
      },
      3,
    );

    if (error) throw new Error(error.message);
    return ((data as KnowledgeChunk[]) ?? []).map((chunk, index) => ({
      ...chunk,
      sources: ['vector'],
      original_ranks: { vector: index + 1 },
    }));
  }

  private isTransientError(error: unknown): boolean {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';
    return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|502|503|504|429/i.test(
      msg,
    );
  }

  private async withTransientRetry<T>(
    op: string,
    fn: () => Promise<T>,
    attempts = 2,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isTransientError(error) || i === attempts) {
          break;
        }
        this.logger.warn(
          `${op} 第 ${i} 次失败，准备重试：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * i));
      }
    }
    throw lastError;
  }
}
