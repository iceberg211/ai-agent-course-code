import type { RagSemanticCacheKeyResult } from '@/knowledge-content/cache/rag-semantic-cache-key';
import type { RagSemanticCacheScope } from '@/knowledge-content/cache/rag-semantic-cache-store.service';
import type { RetrieveKnowledgeDebugResult } from '@/knowledge-content/types/knowledge-content.types';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

export interface MountedKnowledgeConfig {
  knowledgeId: string;
  threshold: number;
  stage1TopK: number;
  retrievalConfig: Partial<KnowledgeRetrievalConfig>;
  updatedAt: string | null;
}

export interface PersonaSemanticCacheContext {
  keyResult: RagSemanticCacheKeyResult;
  scope: RagSemanticCacheScope;
  mountedKnowledgeBaseIds: string[];
  queryEmbedding?: number[];
}

export interface PersonaSemanticCacheResolution {
  context: PersonaSemanticCacheContext | null;
  cachedResult?: RetrieveKnowledgeDebugResult;
}
