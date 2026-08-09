import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

export interface RerankInput {
  query: string;
  candidates: KnowledgeChunk[];
  topK?: number;
  minScore?: number;
  signal?: AbortSignal;
}

export interface RerankerProvider {
  rerank(input: RerankInput): Promise<KnowledgeChunk[]>;
}
