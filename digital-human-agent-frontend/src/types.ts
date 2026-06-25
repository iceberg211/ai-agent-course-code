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
  id?: string
  document_id?: string
  documentId?: string
  source?: string
  chunkIndex?: number
  chunk_index?: number
  knowledgeBaseId?: string
  knowledge_base_id?: string
  similarity?: number
  rerank_score?: number
  hybrid_score?: number
  keyword_score?: number
  graph_score?: number
  retrieval_sources?: string[]
  content?: string
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
  feedback?: 'up' | 'down' | null
  latencyMs?: number | null
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
  knowledgeBaseId?: string
  knowledge_base_id?: string
  knowledge?: KnowledgeBase
  filename: string
  ownerId?: string | null
  owner_id?: string | null
  status: string
  processingStage?: string
  processing_stage?: string
  processingError?: string | null
  processing_error?: string | null
  graphSyncStatus?: string
  graph_sync_status?: string
  graphSyncError?: string | null
  graph_sync_error?: string | null
  tags?: string[]
  department?: string | null
  businessCategory?: string | null
  business_category?: string | null
  visibility?: 'private' | 'department' | 'company'
  expiresAt?: string | null
  expires_at?: string | null
  versionGroupId?: string | null
  version_group_id?: string | null
  versionNo?: number
  version_no?: number
  isCurrentVersion?: boolean
  is_current_version?: boolean
  archivedAt?: string | null
  archived_at?: string | null
  chunkCount?: number
  chunk_count?: number
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

export interface KnowledgeSearchChunk {
  id: string
  document_id?: string
  documentId?: string
  knowledge_base_id?: string
  knowledgeBaseId?: string
  source: string
  chunk_index: number
  chunkIndex?: number
  content: string
  similarity: number
  rerank_score?: number
  hybrid_score?: number
  keyword_score?: number
  graph_score?: number
  retrieval_sources?: string[]
}

export interface KnowledgeSearchResult {
  query: string
  retrievalQuery?: string
  retrievalQueries?: unknown[]
  rewrite?: unknown
  retrievalTrace?: unknown[]
  hybridChunks?: KnowledgeSearchChunk[]
  rerankedChunks?: KnowledgeSearchChunk[]
  options?: {
    rerank: boolean
    threshold: number
    stage1TopK: number
    finalTopK: number
  }
  stage1?: KnowledgeSearchChunk[]
  stage2?: KnowledgeSearchChunk[]
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
  mime_type?: string | null
  fileSize?: number | null
  file_size?: number | null
  sourceType: 'upload'
}

export interface ApiKeyItem {
  id: string
  name: string
  keyPrefix: string
  keyLastFour: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  key?: string
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ConversationSummary {
  id: string
  personaId: string
  ownerId: string | null
  createdAt: string
  updatedAt: string
  lastMessage?: ChatMessage | null
}

export interface DashboardSummary {
  knowledgeBaseCount: number
  documentCount: number
  chunkCount: number
  failedDocumentCount: number
  conversationCount: number
  messageCount: number
  recentDocuments: KnowledgeDocument[]
  recentConversations: ConversationSummary[]
  failedDocumentTrend?: Array<{ date: string; count: number }>
  hotQuestions?: Array<{ question: string; count: number }>
  lowRatedAnswers?: Array<{
    question: string
    answer: string
    answerId: string
    createdAt: string
  }>
  noCitationRate?: number
  recentFailedDocuments?: KnowledgeDocument[]
  unchunkedDocumentCount?: number
  graphFailedDocumentCount?: number
  evalPassRate?: number
}

export interface ChunkContext {
  document: KnowledgeDocument
  chunk: KnowledgeChunk
  before: number
  after: number
  items: KnowledgeChunk[]
}

export interface KnowledgeEvalCase {
  id: string
  knowledgeBaseId: string
  knowledge_base_id?: string
  question: string
  expectedAnswer?: string | null
  expected_answer?: string | null
  lastRunActualAnswer?: string | null
  last_run_actual_answer?: string | null
  lastRunStatus?: string
  last_run_status?: string
  lastRunHitRate?: number | null
  last_run_hit_rate?: number | null
  lastRunRecall?: number | null
  last_run_recall?: number | null
  lastRunError?: string | null
  last_run_error?: string | null
  userReviewStatus?: 'passed' | 'failed' | 'unreviewed' | string
  user_review_status?: 'passed' | 'failed' | 'unreviewed' | string
  lastRunAt?: string | null
  last_run_at?: string | null
  createdAt: string
  created_at?: string
  updatedAt: string
  updated_at?: string
}

export interface NotificationItem {
  id: string
  ownerId?: string | null
  owner_id?: string | null
  type: string
  title: string
  message?: string | null
  payload?: Record<string, unknown>
  readAt?: string | null
  read_at?: string | null
  createdAt: string
  created_at?: string
}

export interface NotificationListResult extends PaginatedResult<NotificationItem> {
  unreadCount: number
}
