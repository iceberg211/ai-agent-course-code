import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';

export type KnowledgeRetrievalSource = 'vector' | 'keyword' | 'hyde';
export type KeywordBackend = 'pg' | 'elastic';
export type VectorBackend = 'pgvector';
export type RetrievalQueryAngle =
  | 'original'
  | 'entity'
  | 'semantic'
  | 'symptom'
  | 'detail';

export interface KnowledgeChunk {
  id: string;
  document_id?: string;
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
  matched_queries?: number[];
  keyword_backend?: KeywordBackend;
  vector_backend?: VectorBackend;
}

export interface RetrieveKnowledgeOptions {
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  finalTopK?: number;
  strategy?: RetrievalStrategy;
  signal?: AbortSignal;
}

export type NormalizedRetrieveKnowledgeOptions = Required<
  Omit<RetrieveKnowledgeOptions, 'signal' | 'strategy'>
> & {
  strategy?: RetrievalStrategy;
};

export interface RetrievalQueryItem {
  index: number;
  query: string;
  keywords: string[];
  angle: RetrievalQueryAngle;
}

export interface KnowledgeQueryRewriteResult {
  originalQuery: string;
  rewrittenQuery: string;
  keywords: string[];
  expandedQueries: RetrievalQueryItem[];
  changed: boolean;
  reason: string;
}

export interface RetrieveKnowledgeTraceItem {
  knowledgeId: string;
  queryIndex: number;
  query: string;
  keywords: string[];
  angle: RetrievalQueryAngle;
  vectorBackend: VectorBackend;
  keywordBackend: KeywordBackend | 'disabled';
  vectorResultCount: number;
  hydeVectorResultCount: number;
  keywordResultCount: number;
  mergedResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'hyde'>;
}

export interface RetrieveKnowledgeDebugResult {
  query: string;
  retrievalQuery: string;
  retrievalQueries: RetrievalQueryItem[];
  rewrite: KnowledgeQueryRewriteResult;
  options: NormalizedRetrieveKnowledgeOptions;
  stage1Trace: RetrieveKnowledgeTraceItem[];
  stage1: KnowledgeChunk[];
  stage2: KnowledgeChunk[];
}

export interface IngestKnowledgeDocumentOptions {
  mimeType?: string;
  fileSize?: number;
  category?: string;
}
