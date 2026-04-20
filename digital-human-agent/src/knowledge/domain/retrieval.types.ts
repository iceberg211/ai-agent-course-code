import type { KnowledgeBaseRetrievalConfig } from '../knowledge-base/knowledge-base.entity';
import type { QueryRewriteMessage } from './retrieval/query-rewrite.service';
import type { RetrievalOrigin } from './domain/rag-debug.types';

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  similarity?: number;
  bm25_score?: number;
  fusion_score?: number;
  knowledge_base_id?: string;
  document_id?: string;
  rerank_score?: number;
  sources?: RetrievalOrigin[];
  original_ranks?: Partial<Record<RetrievalOrigin, number>>;
}

export interface RetrieveKnowledgeOptions {
  retrievalMode?: KnowledgeBaseRetrievalConfig['retrievalMode'];
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  vectorTopK?: number;
  keywordTopK?: number;
  candidateLimit?: number;
  finalTopK?: number;
  fusion?: Partial<KnowledgeBaseRetrievalConfig['fusion']>;
  confidence?: Partial<NonNullable<KnowledgeBaseRetrievalConfig['confidence']>>;
  rewrite?: boolean;
  history?: QueryRewriteMessage[];
}

export interface NormalizedRetrieveOptions {
  retrievalMode: KnowledgeBaseRetrievalConfig['retrievalMode'];
  threshold: number;
  rerank: boolean;
  stage1TopK: number;
  vectorTopK: number;
  keywordTopK: number;
  candidateLimit: number;
  finalTopK: number;
  fusion: KnowledgeBaseRetrievalConfig['fusion'];
  confidence: Required<
    NonNullable<KnowledgeBaseRetrievalConfig['confidence']>
  >;
  rewrite: boolean;
}

export interface HybridRetrievalResult {
  vectorHits: KnowledgeChunk[];
  keywordHits: KnowledgeChunk[];
  stage1Hits: KnowledgeChunk[];
}
