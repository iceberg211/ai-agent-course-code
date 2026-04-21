export interface KnowledgeChunkIndexDocument {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  source: string;
  category: string | null;
  enabled: boolean;
}

export interface KnowledgeChunkIndexCursor {
  createdAt: string;
  id: string;
}
