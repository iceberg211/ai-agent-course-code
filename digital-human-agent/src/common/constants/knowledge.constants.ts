import type { KnowledgeRetrievalConfig } from '@/knowledge/entities/knowledge.entity';

export const DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG: KnowledgeRetrievalConfig = {
  threshold: 0.6,
  retrievalLimit: 20,
  rerankLimit: 5,
  rerank: true,
};

export const ELASTICSEARCH_CLIENT = 'ELASTICSEARCH_CLIENT';
export const DEFAULT_ELASTICSEARCH_URL = 'http://localhost:9200';
export const DEFAULT_ELASTICSEARCH_INDEX_PREFIX = 'digital-human';
export const DEFAULT_ELASTICSEARCH_INDEX_VERSION = 'v2';
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

// 联网搜索默认配置
export const DEFAULT_BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';
export const DEFAULT_BOCHA_SEARCH_COUNT = 8;

// 检索流分支与降级限制
export const DEFAULT_QUERY_REWRITE_MAX_EXPANSIONS = 3;
export const DEFAULT_FALLBACK_KEYWORD_LIMIT = 6;

// 文本切片及 Embedding 配置
export const DEFAULT_KNOWLEDGE_CHUNK_SIZE = 500;
export const DEFAULT_KNOWLEDGE_CHUNK_OVERLAP = 100;
export const DEFAULT_EMBEDDINGS_BATCH_SIZE_DEFAULT = 10;

// 检索标准化边界值限制
export const RETRIEVAL_LIMIT_MAX = 50;
export const RERANK_LIMIT_MIN = 1;
export const RERANK_LIMIT_MAX = 20;
export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 1;

// 结构化切片与上下文扩展配置
export const STRUCTURED_CHUNK_MAX_LENGTH = 900;
export const MAX_CONTEXT_EXPANSION_WINDOW = 2;

