export type ConversationState =
  | 'idle'
  | 'recording'
  | 'thinking'
  | 'speaking'
  | 'closed'

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'completed' | 'interrupted' | 'failed'

export interface Citation {
  source?: string
  chunkIndex?: number
  chunk_index?: number
  similarity?: number
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
}

export interface WsEnvelope<T = Record<string, unknown>> {
  type: string
  sessionId: string
  turnId?: string
  payload?: T
}
