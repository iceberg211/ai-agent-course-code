export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  similarity: number;
  knowledge_base_id?: string;
  rerank_score?: number;
}

export interface RetrieveKnowledgeOptions {
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  finalTopK?: number;
}

export interface RetrieveKnowledgeDebugResult {
  query: string;
  options: Required<RetrieveKnowledgeOptions>;
  stage1: KnowledgeChunk[];
  stage2: KnowledgeChunk[];
}

export interface IngestKnowledgeDocumentOptions {
  mimeType?: string;
  fileSize?: number;
  category?: string;
}
