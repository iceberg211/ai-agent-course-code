import { Injectable } from '@nestjs/common';
import type { RetrievalOrigin } from './domain/rag-debug.types';
import type { KnowledgeChunk } from './domain/retrieval.types';

interface FuseOptions {
  rrfK: number;
  vectorWeight: number;
  keywordWeight: number;
  candidateLimit: number;
}

@Injectable()
export class FusionService {
  fuse(
    vectorHits: KnowledgeChunk[],
    keywordHits: KnowledgeChunk[],
    options: FuseOptions,
  ): KnowledgeChunk[] {
    const merged = new Map<string, KnowledgeChunk>();

    this.mergeSourceList(merged, vectorHits, 'vector', options);
    this.mergeSourceList(merged, keywordHits, 'keyword', options);

    return Array.from(merged.values())
      .sort((a, b) => {
        const fusionDiff = (b.fusion_score ?? 0) - (a.fusion_score ?? 0);
        if (fusionDiff !== 0) return fusionDiff;
        const rerankDiff = (b.rerank_score ?? 0) - (a.rerank_score ?? 0);
        if (rerankDiff !== 0) return rerankDiff;
        const similarityDiff = (b.similarity ?? 0) - (a.similarity ?? 0);
        if (similarityDiff !== 0) return similarityDiff;
        return (b.bm25_score ?? 0) - (a.bm25_score ?? 0);
      })
      .slice(0, options.candidateLimit);
  }

  private mergeSourceList(
    merged: Map<string, KnowledgeChunk>,
    hits: KnowledgeChunk[],
    origin: RetrievalOrigin,
    options: FuseOptions,
  ) {
    const weight =
      origin === 'vector' ? options.vectorWeight : options.keywordWeight;

    hits.forEach((hit, index) => {
      const rank = index + 1;
      const current = merged.get(hit.id);
      const nextFusionScore =
        (current?.fusion_score ?? 0) + weight / (options.rrfK + rank);

      if (!current) {
        merged.set(hit.id, {
          ...hit,
          sources: hit.sources ?? [origin],
          original_ranks: {
            ...(hit.original_ranks ?? {}),
            [origin]: rank,
          },
          fusion_score: nextFusionScore,
        });
        return;
      }

      merged.set(hit.id, {
        ...current,
        content: current.content || hit.content,
        source: current.source || hit.source,
        chunk_index: current.chunk_index ?? hit.chunk_index,
        category: current.category ?? hit.category,
        knowledge_base_id: current.knowledge_base_id ?? hit.knowledge_base_id,
        document_id: current.document_id ?? hit.document_id,
        similarity: current.similarity ?? hit.similarity,
        bm25_score: current.bm25_score ?? hit.bm25_score,
        rerank_score: current.rerank_score ?? hit.rerank_score,
        sources: this.mergeOrigins(current.sources, origin),
        original_ranks: {
          ...(current.original_ranks ?? {}),
          ...(hit.original_ranks ?? {}),
          [origin]: rank,
        },
        fusion_score: nextFusionScore,
      });
    });
  }

  private mergeOrigins(
    current: RetrievalOrigin[] | undefined,
    incoming: RetrievalOrigin,
  ): RetrievalOrigin[] {
    return Array.from(new Set([...(current ?? []), incoming]));
  }
}
