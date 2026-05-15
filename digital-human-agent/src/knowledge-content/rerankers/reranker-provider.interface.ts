import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export interface RerankerProviderItem {
  index: number;
  score: number;
}

export interface RerankerProviderInput {
  query: string;
  candidates: KnowledgeChunk[];
  topK: number;
  signal?: AbortSignal;
}

export interface RerankerProvider {
  readonly name: string;
  readonly model: string;
  rerank(input: RerankerProviderInput): Promise<RerankerProviderItem[]>;
}
