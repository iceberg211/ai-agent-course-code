import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

export const DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG: KnowledgeRetrievalConfig = {
  threshold: 0.6,
  stage1TopK: 20,
  finalTopK: 5,
  rerank: true,
};

export const ELASTICSEARCH_CLIENT = 'ELASTICSEARCH_CLIENT';
export const DEFAULT_ELASTICSEARCH_URL = 'http://localhost:9200';
export const DEFAULT_ELASTICSEARCH_INDEX_PREFIX = 'digital-human';
export const DEFAULT_ELASTICSEARCH_INDEX_VERSION = 'v1';
export const DEFAULT_HYBRID_KEYWORD_BACKEND = 'pg';

export const KNOWLEDGE_UPLOAD_PDF_MIME_TYPE = 'application/pdf';
export const KNOWLEDGE_UPLOAD_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.log',
] as const;
export const KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET = new Set<string>(
  KNOWLEDGE_UPLOAD_TEXT_EXTENSIONS,
);
