export type RagChainType = 'kb_hit_test' | 'persona_retrieval' | 'agent_answer';
export type RetrievalMode = 'vector' | 'keyword' | 'hybrid';
export type RetrievalOrigin = 'vector' | 'keyword' | 'web';
export type RetrievalRankStage = 'raw' | 'fusion' | 'rerank';
export type ConfidenceMethod =
  | 'none'
  | 'vector_similarity'
  | 'keyword_bm25_normalized'
  | 'hybrid_rerank'
  | 'llm_relevance';

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

// ── 置信度明细 ─────────────────────────────────────────────────────────────────
export interface ConfidenceTrace {
  /** 统一范围 0-1，是低置信度判断的唯一数值入口 */
  finalConfidence: number;
  /** KB 级召回过滤阈值（不是 persona 级 minConfidence） */
  threshold: number;
  method: ConfidenceMethod;
  signals: {
    topSimilarity?: number;
    topBm25Score?: number;
    /** BM25 归一化后的值 = min(1, topBm25Score / keywordBm25SaturationScore) */
    normalizedBm25?: number;
    topFusionScore?: number;
    topRerankScore?: number;
    llmRelevant?: boolean;
    supportingHits?: number;
  };
}

// ── Multi-hop 跟踪 ─────────────────────────────────────────────────────────────
export interface MultiHopTrace {
  enabled: boolean;
  subQuestions: string[];
  hops: Array<{
    index: number;
    query: string;
    rewrittenQuery?: string;
    reason?: string;
    hits: RetrievalHit[];
    lowConfidence: boolean;
  }>;
}

// ── 主 Debug Trace 结构 ────────────────────────────────────────────────────────
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
  /** 低置信度判断的唯一数值来源，必须存在 */
  confidence: ConfidenceTrace;
  stages: RagStageTrace[];
  hits: RetrievalHit[];
  rerank?: RerankTrace;
  multiHop?: MultiHopTrace;
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
