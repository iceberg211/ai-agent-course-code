import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

export interface MountedKnowledgeConfig {
  knowledgeId: string;
  threshold: number;
  stage1TopK: number;
  retrievalConfig: Partial<KnowledgeRetrievalConfig>;
  updatedAt: string | null;
}
