import { Annotation } from '@langchain/langgraph';
import {
  DEFAULT_RAG_MAX_HOPS,
  DEFAULT_RAG_MAX_WEB_SEARCH_ATTEMPTS,
} from '@/agent/agent.constants';
import { DEFAULT_RETRIEVAL_STRATEGY } from '@/common/rag';
import {
  getCurrentQuery,
  toKnowledgeCitations,
  toWorkflowCitations,
} from '@/agent/langgraph/rag.utils';
import type {
  RagStopReason,
  RagWorkflowInput,
  RagWorkflowState,
  RetrievalHistoryItem,
} from '@/agent/types/rag-workflow.types';
import type { ConversationMessage } from '@/conversation/conversation-message.entity';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import type { Persona } from '@/persona/persona.entity';

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
  retrievalStrategy: Annotation<RagWorkflowState['retrievalStrategy']>(),
  retrievalStrategyReason: Annotation<string>(),
  enough: Annotation<boolean | null>(),
  missingFacts: Annotation<string[]>(),
  evaluationReason: Annotation<string>(),
  webQuery: Annotation<string>(),
  webSearchAttempted: Annotation<boolean>(),
  webSearchUsed: Annotation<boolean>(),
  webSearchAttempts: Annotation<number>(),
  maxWebSearchAttempts: Annotation<number>(),
  webSearchQueries: Annotation<string[]>(),
  stopReason: Annotation<RagStopReason>(),
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
    retrievalStrategy: DEFAULT_RETRIEVAL_STRATEGY,
    retrievalStrategyReason: DEFAULT_RETRIEVAL_STRATEGY.reason,
    enough: null,
    missingFacts: [],
    evaluationReason: '',
    webQuery: '',
    webSearchAttempted: false,
    webSearchUsed: false,
    webSearchAttempts: 0,
    maxWebSearchAttempts: DEFAULT_RAG_MAX_WEB_SEARCH_ATTEMPTS,
    webSearchQueries: [],
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
