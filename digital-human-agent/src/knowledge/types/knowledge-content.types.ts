import type { RetrievalStrategy } from '@/common/rag';
import type { KnowledgeRetrievalConfig } from '@/knowledge/entities/knowledge.entity';

export type KnowledgeRetrievalSource =
  | 'vector'
  | 'keyword'
  | 'graph'
  | 'memory'
  | 'multimodal';
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
  memory_score?: number;
  multimodal_score?: number;
  rrf_score?: number;
  channel_rank?: Partial<Record<KnowledgeRetrievalSource, number>>;
  raw_score?: Partial<Record<KnowledgeRetrievalSource, number>>;
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
  retrievalLimit?: number;
  rerankLimit?: number;
  strategy?: Partial<RetrievalStrategy>;
  skipQueryRewrite?: boolean;
  signal?: AbortSignal;
  accessScope?: KnowledgeAccessScope;
  documentFilters?: DocumentSearchFilters;
  /** @deprecated 旧字段兼容 */
  stage1TopK?: number;
  /** @deprecated 旧字段兼容 */
  finalTopK?: number;
}

export type NormalizedRetrieveKnowledgeOptions = Required<
  Omit<
    RetrieveKnowledgeOptions,
    | 'signal'
    | 'strategy'
    | 'skipQueryRewrite'
    | 'accessScope'
    | 'documentFilters'
    | 'stage1TopK'
    | 'finalTopK'
  >
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
  memoryBackend?: string | 'disabled';
  multimodalBackend?: string | 'disabled';
  vectorResultCount: number;
  keywordResultCount: number;
  graphResultCount?: number;
  memoryResultCount?: number;
  multimodalResultCount?: number;
  mergedResultCount: number;
  fallbackToPg: boolean;
  skippedChannels: Array<'vector' | 'keyword' | 'graph' | 'memory' | 'multimodal'>;

  // 阶段 3 升级统计 Trace 字段
  avgVectorScore?: number;
  avgKeywordScore?: number;
  avgGraphScore?: number;
  avgMemoryScore?: number;
  avgMultimodalScore?: number;
  rrfFusion?: RrfTraceItem[];
  finalChunks?: string[];
}

export interface ChannelTrace {
  enabled: boolean;
  backend: string | 'disabled';
  resultCount: number;
  skipped: boolean;
  error?: string;
}

export interface RrfTraceItem {
  chunkId: string;
  retrievalSources: KnowledgeRetrievalSource[];
  channelRanks: Partial<Record<KnowledgeRetrievalSource, number>>;
  rawScores: Partial<Record<KnowledgeRetrievalSource, number>>;
  rrfScore: number;
}

export interface RerankTraceItem {
  chunkId: string;
  beforeRank: number;
  afterRank: number;
  rerankScore: number | null;
}

export interface RetrievalStageTrace {
  queryRewrite: string[];
  channels: Partial<Record<KnowledgeRetrievalSource, ChannelTrace>>;
  rrfFusion: RrfTraceItem[];
  rerank: RerankTraceItem[];
  rerankLatencyMs?: number;
  permissionFilter: {
    before: number;
    after: number;
    filtered: number;
  };
  finalChunks: string[];
}

export interface RetrievalDegradedChannel {
  channel: KnowledgeRetrievalSource | 'queryRewrite' | 'rerank' | 'permission';
  reason: string;
  backend?: string | 'disabled';
}

export interface RetrieveKnowledgeDebugResult {
  query: string;
  retrievalQuery: string;
  retrievalQueries: RetrievalQueryItem[];
  rewrite: KnowledgeQueryRewriteResult;
  options: NormalizedRetrieveKnowledgeOptions;
  retrievalTrace: RetrieveKnowledgeTraceItem[];
  stageTrace?: RetrievalStageTrace;
  degradedChannels?: RetrievalDegradedChannel[];
  hybridChunks: KnowledgeChunk[];
  rerankedChunks: KnowledgeChunk[];
}

export interface MountedKnowledgeConfig {
  knowledgeId: string;
  threshold: number;
  retrievalLimit: number;
  retrievalConfig: Partial<KnowledgeRetrievalConfig>;
  updatedAt: string | null;
}

export interface IngestKnowledgeDocumentOptions {
  mimeType?: string;
  fileSize?: number;
  category?: string;
  ownerId?: string | null;
  tags?: string[];
  department?: string | null;
  businessCategory?: string | null;
  visibility?: 'private' | 'department' | 'company';
  expiresAt?: Date | null;
  versionGroupId?: string | null;
  versionNo?: number;
  isCurrentVersion?: boolean;
  currentIngestRunId?: string | null;
  parseStrategy?: string | null;
  parserVersion?: string | null;
  assetCount?: number;
}

export interface KnowledgeAccessScope {
  ownerId?: string | null;
  department?: string | null;
  role?: string | null;
}

export interface DocumentSearchFilters {
  fileType?: string;
  tags?: string[];
  department?: string;
  businessCategory?: string;
  visibility?: 'private' | 'department' | 'company';
}

export interface KeywordRetrieveParams {
  knowledgeId: string;
  terms: string[];
  matchCount: number;
  useExactPhrase?: boolean;
  documentFilters?: DocumentSearchFilters;
  accessScope?: KnowledgeAccessScope;
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
  globalRetrievalLimit: number;
  documentFilters?: DocumentSearchFilters;
  accessScope?: KnowledgeAccessScope;
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
  useExactPhrase?: boolean;
}

export interface PersonaHybridRetrievalInput {
  personaId: string;
  retrievalQueries: RetrievalQueryItem[];
  strategy?: RetrievalStrategy;
  channels?: PersonaHybridRetrievalChannels;
  threshold?: number;
  retrievalLimit?: number;
  documentFilters?: DocumentSearchFilters;
  accessScope?: KnowledgeAccessScope;
  signal?: AbortSignal;
}

export interface PersonaHybridRetrievalResult {
  chunks: KnowledgeChunk[];
  trace: RetrieveKnowledgeTraceItem[];
  knowledgeCount: number;
  rerankLimit?: number;
}
