export type KnowledgeRetrievalSource = 'vector' | 'keyword';
export type KeywordBackend = 'pg' | 'elastic';

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  similarity: number;
  knowledge_base_id?: string;
  rerank_score?: number;
  keyword_score?: number;
  hybrid_score?: number;
  retrieval_sources?: KnowledgeRetrievalSource[];
}

export interface RetrieveKnowledgeOptions {
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  finalTopK?: number;
}

export interface KnowledgeQueryRewriteResult {
  originalQuery: string;
  rewrittenQuery: string;
  keywords: string[];
  changed: boolean;
  reason: string;
}

export interface RetrieveKnowledgeDebugResult {
  query: string;
  retrievalQuery: string;
  rewrite: KnowledgeQueryRewriteResult;
  options: Required<RetrieveKnowledgeOptions>;
  stage1: KnowledgeChunk[];
  stage2: KnowledgeChunk[];
}

export interface IngestKnowledgeDocumentOptions {
  mimeType?: string;
  fileSize?: number;
  category?: string;
}
