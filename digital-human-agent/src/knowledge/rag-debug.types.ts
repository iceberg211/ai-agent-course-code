export type RagChainType = 'kb_hit_test' | 'persona_retrieval' | 'agent_answer';
export type RetrievalMode = 'vector' | 'keyword' | 'hybrid';
export type RetrievalOrigin = 'vector' | 'keyword' | 'web';
export type RetrievalRankStage = 'raw' | 'fusion' | 'rerank';

export type RagStageName =
  | 'query_rewrite'
  | 'vector_retrieval'
  | 'keyword_retrieval'
  | 'fusion'
  | 'rerank'
  | 'multi_hop'
  | 'web_fallback'
  | 'context_assembly'
  | 'generation';

export interface RagDebugTrace {
  traceId: string;
  langsmithRunId?: string;
  chainType: RagChainType;
  personaId?: string;
  knowledgeBaseIds: string[];
  originalQuery: string;
  rewrittenQuery?: string;
  retrievalMode: RetrievalMode;
  lowConfidence: boolean;
  lowConfidenceReason?: string;
  stages: RagStageTrace[];
  hits: RetrievalHit[];
  rerank?: RerankTrace;
  fallback?: FallbackTrace;
  timingsMs: Record<string, number>;
  createdAt: string;
}

export interface RagStageTrace {
  name: RagStageName;
  input?: unknown;
  output?: unknown;
  skipped?: boolean;
  skipReason?: string;
  latencyMs?: number;
}

export interface RetrievalHit {
  id: string;
  chunkId?: string;
  documentId?: string;
  knowledgeBaseId?: string;
  chunkIndex?: number;
  title?: string;
  sourceName?: string;
  sourceUrl?: string;
  content: string;
  contentPreview: string;
  sources: RetrievalOrigin[];
  rankStage: RetrievalRankStage;
  rank: number;
  originalRanks?: Partial<Record<RetrievalOrigin, number>>;
  score?: number;
  similarity?: number;
  bm25Score?: number;
  fusionScore?: number;
  rerankScore?: number;
  metadata?: Record<string, unknown>;
}

export interface RerankTrace {
  enabled: boolean;
  model?: string;
  before: Array<{ id: string; rank: number; score?: number }>;
  after: Array<{ id: string; rank: number; rerankScore?: number }>;
}

export interface FallbackTrace {
  enabled: boolean;
  used: boolean;
  reason?: string;
  policy: 'never' | 'low_confidence' | 'user_confirmed' | 'realtime_only';
  externalSources: RetrievalHit[];
}
