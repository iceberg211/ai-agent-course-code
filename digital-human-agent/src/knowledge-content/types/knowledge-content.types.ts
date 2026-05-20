import type { RetrievalStrategy } from '@/common/rag';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

export type KnowledgeRetrievalSource = 'vector' | 'keyword' | 'graph';
export type KeywordBackend = 'pg' | 'elastic';
export type VectorBackend = 'pgvector';
export type GraphBackend = 'neo4j';
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
  graph_score?: number;
  graph_evidence?: Array<{
    source: string;
    target: string;
    relationType: string;
    relationLabel?: string | null;
    evidenceText?: string | null;
    confidence?: number;
  }>;
  retrieval_sources?: KnowledgeRetrievalSource[];
  matched_queries?: number[];
  keyword_backend?: KeywordBackend;
  vector_backend?: VectorBackend;
  context_expanded?: boolean;
}

export interface RetrieveKnowledgeOptions {
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  finalTopK?: number;
  strategy?: RetrievalStrategy;
  skipQueryRewrite?: boolean;
  signal?: AbortSignal;
}

export type NormalizedRetrieveKnowledgeOptions = Required<
  Omit<RetrieveKnowledgeOptions, 'signal' | 'strategy' | 'skipQueryRewrite'>
> & {
  strategy?: RetrievalStrategy;
  skipQueryRewrite: boolean;
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
  vectorBackend: VectorBackend | 'disabled';
  keywordBackend: KeywordBackend | 'disabled';
  graphBackend: GraphBackend | 'disabled';
  vectorResultCount: number;
  keywordResultCount: number;
  graphResultCount?: number;
  mergedResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'graph'>;
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

export interface MountedKnowledgeConfig {
  knowledgeId: string;
  threshold: number;
  stage1TopK: number;
  retrievalConfig: Partial<KnowledgeRetrievalConfig>;
  updatedAt: string | null;
}

export interface IngestKnowledgeDocumentOptions {
  mimeType?: string;
  fileSize?: number;
  category?: string;
}

export interface KeywordRetrieveParams {
  knowledgeId: string;
  terms: string[];
  matchCount: number;
  useExactPhrase?: boolean;
  signal?: AbortSignal;
}

export interface KeywordRetrieveResult {
  chunks: KnowledgeChunk[];
  backend: KeywordBackend;
  fallbackToPg: boolean;
}

export interface KnowledgeHybridRetrievalParams {
  knowledgeId: string;
  retrievalQueries: RetrievalQueryItem[];
  strategy: RetrievalStrategy;
  threshold: number;
  globalStage1TopK: number;
  signal?: AbortSignal;
}

export interface KnowledgeHybridRetrievalResult {
  chunks: KnowledgeChunk[];
  trace: RetrieveKnowledgeTraceItem[];
}

export interface PersonaHybridRetrievalChannels {
  useVector: boolean;
  useKeyword: boolean;
  useGraph: boolean;
}

export interface PersonaHybridRetrievalInput {
  personaId: string;
  query: string;
  terms: string[];
  matchCount: number;
  channels: PersonaHybridRetrievalChannels;
  signal?: AbortSignal;
}

export interface PersonaHybridRetrievalResult {
  chunks: KnowledgeChunk[];
  trace: RetrieveKnowledgeTraceItem[];
}

