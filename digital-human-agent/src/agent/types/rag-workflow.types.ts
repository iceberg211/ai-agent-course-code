import type {
  RagEvidenceAssessmentContext,
  RagStopReason,
  RetrievalStrategy,
} from '@/common/rag';
import type { RagProfileId } from '@/common/rag/rag-profile';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type {
  KnowledgeAccessScope,
  KnowledgeQueryRewriteResult,
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';
import type {
  MemoryRecord,
  ShortTermMemoryContext,
} from '@/memory/memory.types';

export type RagStrategy = 'simple' | 'complex' | 'none';
export type RagOrchestratorName = 'langgraph';
export type RetrievalChannel = 'vector' | 'keyword' | 'graph' | 'web';

export type {
  RagEvidenceAssessmentContext,
  RagStopReason,
  RetrievalStrategy,
} from '@/common/rag';

export interface RetrievalHistoryItem {
  query: string;
  resultCount: number;
  skipped?: boolean;
  reason?: string;
  strategy?: RetrievalStrategy;
}

export interface GraphReasoningTraceItem {
  knowledgeId: string;
  matchedEntities: Array<{
    key: string;
    name: string;
  }>;
  expandedChunkIds: string[];
  expandedChunkCount: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface RagKnowledgeCitation extends RetrievedKnowledgeChunk {
  kind: 'knowledge';
}

export interface RagWebCitation {
  kind: 'web';
  title: string;
  url: string;
  snippet: string;
  siteName: string | null;
  publishedAt: string | null;
}

export type RagCitation = RagKnowledgeCitation | RagWebCitation;

export interface RagWorkflowInput {
  conversationId: string;
  personaId: string;
  question: string;
  turnId: string;
  signal: AbortSignal;
  onToken: (token: string) => void;
  onCitations: (citations: RagCitation[]) => void;
  accessScope?: KnowledgeAccessScope;
  maxHops?: number;
  /** 执行剖面；未传时 orchestrator 默认 balanced_chat */
  profileId?: RagProfileId;
  /** HTTP/WS 入口接收本轮消息的时间戳（ms）。 */
  startedAt?: number;
}

export interface RagWorkflowState {
  conversationId: string;
  personaId: string;
  question: string;
  turnId: string;
  strategy: RagStrategy;
  routeReason: string;
  subQuestions: string[];
  nextSubIdx: number;
  currentQuery: string;
  currentHop: number;
  maxHops: number;
  documents: RetrievedKnowledgeChunk[];
  topDocuments: RetrievedKnowledgeChunk[];
  evidenceChunks: RetrievedKnowledgeChunk[];
  localCitations: RagKnowledgeCitation[];
  webCitations: RagWebCitation[];
  citations: RagCitation[];
  retrievalHistory: RetrievalHistoryItem[];
  retrievalTrace: RetrieveKnowledgeTraceItem[];
  graphReasoningTrace: GraphReasoningTraceItem[];
  shortTermMemory: ShortTermMemoryContext;
  longTermMemories: MemoryRecord[];
  memoryContext: string;
  retrievalStrategy: RetrievalStrategy;
  retrievalStrategyReason: string;
  /** 路由级是否允许联网（跨 hop 保持） */
  routeAllowWeb: boolean;
  workflowStartedAt: number;
  workflowBudgetMs: number;
  /** 当前执行剖面 */
  profileId: RagProfileId;
  /** evaluate 模式：off | heuristic | llm */
  evaluateMode: 'off' | 'heuristic' | 'llm';
  /** rerank 模式：off | score | llm | dedicated */
  rerankMode: 'off' | 'score' | 'llm' | 'dedicated';
  /** 是否注入长期记忆（不进检索 query） */
  useLongTermMemory: boolean;
  /** 路由模式 */
  routeMode: 'heuristic' | 'llm';
  enough: boolean | null;
  missingFacts: string[];
  evaluationReason: string;
  webQuery: string;
  webSearchAttempted: boolean;
  webSearchUsed: boolean;
  webSearchAttempts: number;
  maxWebSearchAttempts: number;
  webSearchQueries: string[];
  stopReason: RagStopReason;
  orchestrator: RagOrchestratorName;
  rerankLimit: number;
}

export interface RagTurnBudgetSnapshot {
  llmCalls: number;
  embedCalls: number;
  firstTokenLatencyMs: number | null;
  degradationFlags: string[];
}

export interface RagWorkflowResult {
  state: RagWorkflowState;
  citations: RagCitation[];
  answerText: string;
  /** 本轮解析后的 profileId，便于入口拼 report */
  profileId?: RagProfileId;
  /** 本轮预算计数快照（ALS 退出后仍可读） */
  budgetSnapshot?: RagTurnBudgetSnapshot;
}

export interface RagRouteDecision {
  strategy: RagStrategy;
  reason: string;
}

export interface RagMultiHopPlan {
  subQuestions: string[];
  reason: string;
}

export interface RagEvidenceEvaluation {
  enough: boolean;
  missingFacts: string[];
  reason: string;
  webQuery: string;
}

export interface RagRetrievalStrategyDecision extends RetrievalStrategy {}

export interface RagQueryAugmentationPlan {
  rewrite: KnowledgeQueryRewriteResult;
  retrievalQueries: RetrievalQueryItem[];
  strategy: RetrievalStrategy;
  currentQuery: string;
}

export interface RagOrchestrator {
  run(input: RagWorkflowInput): Promise<RagWorkflowResult>;
}
