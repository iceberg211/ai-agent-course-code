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

/**
 * 统一检索请求：Agent（persona）与 Search（单库 / 跨库）共用。
 * 作用域三选一：personaId | knowledgeId | knowledgeIds
 */
export interface RetrievalPortRequest {
  retrievalQueries: RetrievalQueryItem[];
  strategy: RetrievalStrategy;
  accessScope?: KnowledgeAccessScope;
  signal?: AbortSignal;
  /** hybrid graph channel 之外，是否做一跳邻居扩展 */
  graphExpand?: boolean;
  /** 用于实体匹配的问题/当前 hop query */
  question?: string;
  currentQuery?: string;
  /** 稳定缓存分区（profile id），勿塞动态 reason */
  profileId?: string;
  /** Persona 聚合检索 */
  personaId?: string;
  /** 单知识库 */
  knowledgeId?: string;
  /** 跨知识库 */
  knowledgeIds?: string[];
  threshold?: number;
  retrievalLimit?: number;
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
