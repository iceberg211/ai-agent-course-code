import { Annotation } from '@langchain/langgraph';
import { DEFAULT_RAG_MAX_HOPS } from '@/agent/agent.constants';
import {
  getCurrentQuery,
  toKnowledgeCitations,
  toWorkflowCitations,
} from '@/agent/langgraph/rag.utils';
import type {
  RagWorkflowInput,
  RagWorkflowState,
} from '@/agent/types/rag-workflow.types';
import type { ConversationMessage } from '@/conversation/conversation-message.entity';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import type { Persona } from '@/persona/persona.entity';

export type RetrievalHistoryItem = { query: string; resultCount: number };

export const RagGraphStateAnnotation = Annotation.Root({
  conversationId: Annotation<string>(),
  personaId: Annotation<string>(),
  question: Annotation<string>(),
  turnId: Annotation<string>(),
  strategy: Annotation<'simple' | 'complex'>(),
  routeReason: Annotation<string>(),
  subQuestions: Annotation<string[]>(),
  currentHop: Annotation<number>(),
  maxHops: Annotation<number>(),
  evidenceChunks: Annotation<RetrievedKnowledgeChunk[]>(),
  webCitations: Annotation<RagWorkflowState['webCitations']>(),
  retrievalHistory: Annotation<RetrievalHistoryItem[]>(),
  enough: Annotation<boolean | null>(),
  missingFacts: Annotation<string[]>(),
  evaluationReason: Annotation<string>(),
  webQuery: Annotation<string>(),
  webSearchAttempted: Annotation<boolean>(),
  webSearchUsed: Annotation<boolean>(),
  stopReason: Annotation<string>(),
  orchestrator: Annotation<'langgraph'>(),
  answerText: Annotation<string>(),
  persona: Annotation<Persona | null>(),
  history: Annotation<ConversationMessage[]>(),
});

export type RagGraphState = typeof RagGraphStateAnnotation.State;

export function getRagWorkflowCitations(
  state: Pick<RagGraphState, 'evidenceChunks' | 'webCitations'>,
) {
  return toWorkflowCitations(state);
}

export function buildInitialRagGraphState(
  input: RagWorkflowInput,
): RagGraphState {
  return {
    conversationId: input.conversationId,
    personaId: input.personaId,
    question: input.question,
    turnId: input.turnId,
    strategy: 'simple',
    routeReason: '尚未执行路由',
    subQuestions: [],
    currentHop: 0,
    maxHops: input.maxHops ?? DEFAULT_RAG_MAX_HOPS,
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    enough: null,
    missingFacts: [],
    evaluationReason: '',
    webQuery: '',
    webSearchAttempted: false,
    webSearchUsed: false,
    stopReason: '',
    orchestrator: 'langgraph',
    answerText: '',
    persona: null,
    history: [],
  };
}

export function toRagWorkflowState(state: RagGraphState): RagWorkflowState {
  const {
    answerText: _answerText,
    persona: _persona,
    history: _history,
    ...workflowState
  } = state;

  return {
    ...workflowState,
    currentQuery: getCurrentQuery(state),
    localCitations: toKnowledgeCitations(state.evidenceChunks),
    citations: getRagWorkflowCitations(state),
  };
}
