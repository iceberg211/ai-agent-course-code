import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export type RagStrategy = 'simple' | 'complex';

export interface RagWorkflowInput {
  conversationId: string;
  personaId: string;
  question: string;
  turnId: string;
  signal: AbortSignal;
  onToken: (token: string) => void;
  onCitations: (citations: RetrievedKnowledgeChunk[]) => void;
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
  currentHop: number;
  maxHops: number;
  evidenceChunks: RetrievedKnowledgeChunk[];
  citations: RetrievedKnowledgeChunk[];
  orchestrator: 'default';
}

export interface RagWorkflowResult {
  state: RagWorkflowState;
  citations: RetrievedKnowledgeChunk[];
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

export interface RagOrchestrator {
  run(input: RagWorkflowInput): Promise<RagWorkflowResult>;
}
