import type {
  RagEvidenceAssessmentContext,
  RagStopReason,
  RetrievalStrategy,
} from '@/common/rag';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type {
  KnowledgeQueryRewriteResult,
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';

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
  maxHops?: number;
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
  plannedNext: '' | 'retrieve' | 'rerank';
  retrievalStrategy: RetrievalStrategy;
  retrievalStrategyReason: string;
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

export interface RagWorkflowResult {
  state: RagWorkflowState;
  citations: RagCitation[];
  answerText: string;
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
