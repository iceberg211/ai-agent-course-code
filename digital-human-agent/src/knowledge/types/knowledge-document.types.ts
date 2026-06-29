export interface KnowledgeDocumentChunk {
  pageContent: string;
}

export interface RecursiveChunkSplitter {
  createDocuments(texts: string[]): Promise<KnowledgeDocumentChunk[]>;
}

export interface MarkdownHeading {
  level: number;
  line: string;
}

export interface MarkdownSection {
  headings: MarkdownHeading[];
  bodyLines: string[];
}

export interface KnowledgeDocumentChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  source: string;
  category: string | null;
  enabled: boolean;
  embedding: string;
  source_asset_key?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
}
