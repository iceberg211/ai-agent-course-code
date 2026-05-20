import { Injectable } from '@nestjs/common';
import { throwIfAborted } from '@/common/utils';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class VectorRetrieverService {
  constructor(private readonly runtime: ContentRuntimeService) {}

  async retrieve(params: {
    knowledgeId: string;
    queryEmbedding: number[];
    threshold: number;
    matchCount: number;
    signal?: AbortSignal;
  }): Promise<KnowledgeChunk[]> {
    return runInTracedScope(
      {
        name: 'knowledge_vector_retrieve',
        runType: 'retriever',
        tags: ['knowledge', 'rag', 'retrieve', 'vector'],
        metadata: {
          knowledgeId: params.knowledgeId,
          threshold: params.threshold,
          matchCount: params.matchCount,
        },
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
      },
      async () => {
        throwIfAborted(params.signal);
        const { data, error } = await this.runtime.withTransientRetry<{
          data: KnowledgeChunk[] | null;
          error: { message: string } | null;
        }>(
          'match_knowledge rpc',
          async () => {
            throwIfAborted(params.signal);
            const query = this.runtime.supabase.rpc('match_knowledge', {
              query_embedding: params.queryEmbedding,
              p_kb_id: params.knowledgeId,
              match_threshold: params.threshold,
              match_count: params.matchCount,
            });
            const result = params.signal
              ? await query.abortSignal(params.signal)
              : await query;

            return {
              data: (result.data as KnowledgeChunk[] | null) ?? null,
              error: result.error ? { message: result.error.message } : null,
            };
          },
          3,
        );
        throwIfAborted(params.signal);

        if (error) {
          throw new Error(error.message);
        }

        return (data ?? []).map((chunk) => ({
          ...chunk,
          retrieval_sources: ['vector' as const],
        }));
      },
    );
  }
}
