import { Injectable } from '@nestjs/common';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

interface VectorRetrieveParams {
  knowledgeId: string;
  queryEmbedding: number[];
  threshold: number;
  matchCount: number;
}

@Injectable()
export class KnowledgeVectorRetrieverService {
  constructor(private readonly runtime: KnowledgeContentRuntimeService) {}

  async retrieve(params: VectorRetrieveParams): Promise<KnowledgeChunk[]> {
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
        const { data, error } = await this.runtime.withTransientRetry<{
          data: KnowledgeChunk[] | null;
          error: { message: string } | null;
        }>(
          'match_knowledge rpc',
          async () => {
            const result = await this.runtime.supabase.rpc('match_knowledge', {
              query_embedding: params.queryEmbedding,
              p_kb_id: params.knowledgeId,
              match_threshold: params.threshold,
              match_count: params.matchCount,
            });

            return {
              data: (result.data as KnowledgeChunk[] | null) ?? null,
              error: result.error ? { message: result.error.message } : null,
            };
          },
          3,
        );

        if (error) {
          throw new Error(error.message);
        }

        return (data ?? []).map((chunk) => ({
          ...chunk,
          retrieval_sources: ['vector'],
        }));
      },
    );
  }
}
