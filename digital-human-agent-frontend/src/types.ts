export type ConversationState =
  | 'idle'
  | 'recording'
  | 'thinking'
  | 'speaking'
  | 'closed'

export type ConversationMode = 'voice' | 'digital-human'

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'completed' | 'interrupted' | 'failed'

export interface Citation {
  source?: string
  chunkIndex?: number
  chunk_index?: number
  knowledgeBaseId?: string
  knowledge_base_id?: string
  similarity?: number
  knowledgeBaseName?: string
  [key: string]: unknown
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  status: MessageStatus
  citations: Citation[]
  streaming: boolean
  turnId?: string
}

export interface Persona {
  id: string
  name: string
  description?: string
  speakingStyle?: string
  expertise?: string[]
  voiceId?: string
  avatarId?: string
  systemPromptExtra?: string
  createdAt?: string
  updatedAt?: string
}

export type VoiceCloneStatus =
  | 'not_started'
  | 'pending'
  | 'training'
  | 'ready'
  | 'failed'

export interface VoiceCloneState {
  personaId: string
  status: VoiceCloneStatus
  voiceId: string | null
  providerTaskId: string | null
  sampleFilename: string | null
  updatedAt: string
  errorMessage?: string
}

export interface KnowledgeDocument {
  id: string
  filename: string
  status: string
  chunkCount?: number
  createdAt?: string
}

export interface KnowledgeSearchChunk {
  id: string
  source: string
  chunk_index: number
  content: string
  similarity: number
  rerank_score?: number
}

export type RetrievalOrigin = 'vector' | 'keyword' | 'web'
export type RetrievalRankStage = 'raw' | 'fusion' | 'rerank'
export type RagStageName =
  | 'query_rewrite'
  | 'vector_retrieval'
  | 'keyword_retrieval'
  | 'fusion'
  | 'rerank'
  | 'multi_hop'
  | 'web_fallback'
  | 'context_assembly'
  | 'generation'

export interface RetrievalHit {
  id: string
  chunkId?: string
  documentId?: string
  knowledgeBaseId?: string
  chunkIndex?: number
  title?: string
  sourceName?: string
  sourceUrl?: string
  content: string
  contentPreview: string
  sources: RetrievalOrigin[]
  rankStage: RetrievalRankStage
  rank: number
  originalRanks?: Partial<Record<RetrievalOrigin, number>>
  score?: number
  similarity?: number
  bm25Score?: number
  fusionScore?: number
  rerankScore?: number
  metadata?: Record<string, unknown>
}

export interface RagStageTrace {
  name: RagStageName
  input?: unknown
  output?: unknown
  skipped?: boolean
  skipReason?: string
  latencyMs?: number
}

export interface RagDebugTrace {
  traceId: string
  langsmithRunId?: string
  chainType: 'kb_hit_test' | 'persona_retrieval' | 'agent_answer'
  personaId?: string
  knowledgeBaseIds: string[]
  originalQuery: string
  rewrittenQuery?: string
  retrievalMode: 'vector' | 'keyword' | 'hybrid'
  lowConfidence: boolean
  lowConfidenceReason?: string
  stages: RagStageTrace[]
  hits: RetrievalHit[]
  rerank?: {
    enabled: boolean
    model?: string
    before: Array<{ id: string; rank: number; score?: number }>
    after: Array<{ id: string; rank: number; rerankScore?: number }>
  }
  fallback?: {
    enabled: boolean
    used: boolean
    reason?: string
    policy: 'never' | 'low_confidence' | 'user_confirmed' | 'realtime_only'
    externalSources: RetrievalHit[]
  }
  timingsMs: Record<string, number>
  createdAt: string
}

export interface KnowledgeSearchResult {
  query: string
  options?: {
    rerank: boolean
    threshold: number
    stage1TopK: number
    finalTopK: number
  }
  stage1: KnowledgeSearchChunk[]
  stage2: KnowledgeSearchChunk[]
  debugTrace?: RagDebugTrace
}

/**
 * 文字流消息的附加元数据（由 AI SDK Chat 回调携带）。
 */
export interface StreamMetadata {
  conversationId?: string
  turnId?: string
  status?: MessageStatus | 'streaming'
  citations?: Citation[]
}

export interface WsEnvelope<T = Record<string, unknown>> {
  type: string
  sessionId: string
  turnId?: string
  payload?: T
}

// ── Knowledge Base ─────────────────────────────────────────────────────────

export interface RetrievalConfig {
  threshold: number
  stage1TopK: number
  finalTopK: number
  rerank: boolean
}

export interface KnowledgeBase {
  id: string
  name: string
  description?: string | null
  ownerPersonaId?: string | null
  retrievalConfig: RetrievalConfig
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  charCount: number
  enabled: boolean
  source: string
  category?: string | null
  createdAt: string
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  knowledgeBaseId: string
  mimeType?: string | null
  fileSize?: number | null
  sourceType: 'upload'
}
