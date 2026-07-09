import type { RetrievalStrategy } from '@/common/rag';
import type {
  KnowledgeAccessScope,
  KnowledgeChunk,
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';

export const RETRIEVAL_PORT = 'RETRIEVAL_PORT';

export interface GraphExpandTraceItem {
  knowledgeId: string;
  matchedEntities: Array<{ key: string; name: string }>;
  expandedChunkIds: string[];
  expandedChunkCount: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface RetrievalPortRequest {
  personaId: string;
  retrievalQueries: RetrievalQueryItem[];
  strategy: RetrievalStrategy;
  accessScope?: KnowledgeAccessScope;
  signal?: AbortSignal;
  /** hybrid graph channel 之外，是否做一跳邻居扩展 */
  graphExpand?: boolean;
  /** 用于实体匹配的问题/当前 hop query */
  question?: string;
  currentQuery?: string;
}

export interface RetrievalPortResponse {
  chunks: KnowledgeChunk[];
  trace: RetrieveKnowledgeTraceItem[];
  knowledgeCount: number;
  rerankLimit?: number;
  graphExpandTrace?: GraphExpandTraceItem[];
}

/**
 * Agent / Search 共用的检索端口。
 * 实现应基于 Hybrid +（可选）GraphExpand，而不是平行第二套流水线。
 */
export interface RetrievalPort {
  retrieve(request: RetrievalPortRequest): Promise<RetrievalPortResponse>;
}
