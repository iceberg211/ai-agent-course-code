export type MemoryVisibility = 'private' | 'department' | 'company';
export type MemoryCategory =
  | 'preference'
  | 'profile'
  | 'business_context'
  | 'task_goal'
  | 'conversation_summary';

export interface AddMemoryInput {
  ownerId: string;
  content: string;
  category?: MemoryCategory;
  department?: string | null;
  visibility?: MemoryVisibility;
  sourceConversationId?: string | null;
  confidence?: number;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface SearchMemoryInput {
  ownerId?: string | null;
  department?: string | null;
  query?: string;
  limit?: number;
}

export interface DeleteMemoryInput {
  id: string;
  ownerId?: string | null;
}

export interface MemoryRecord {
  id: string;
  ownerId: string;
  department: string | null;
  visibility: MemoryVisibility;
  category: MemoryCategory;
  content: string;
  sourceConversationId: string | null;
  confidence: number;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMemoryItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
  turnId?: string | null;
  createdAt?: string;
}

export interface ShortTermMemoryContext {
  window: ConversationMemoryItem[];
  summary: string;
  activeContext: string;
}

export interface LongTermMemoryProvider {
  add(input: AddMemoryInput): Promise<MemoryRecord>;
  search(input: SearchMemoryInput): Promise<MemoryRecord[]>;
  delete(input: DeleteMemoryInput): Promise<void>;
}

export const LONG_TERM_MEMORY_PROVIDER = Symbol('LONG_TERM_MEMORY_PROVIDER');

