import { Annotation } from '@langchain/langgraph';
import {
  DEFAULT_RAG_MAX_HOPS,
  DEFAULT_RAG_MAX_WEB_SEARCH_ATTEMPTS,
} from '@/agent/agent.constants';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
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
import type { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type { Persona } from '@/persona/persona.entity';

export const RagGraphStateAnnotation = Annotation.Root({
  conversationId: Annotation<string>(),
  personaId: Annotation<string>(),
  question: Annotation<string>(),
  turnId: Annotation<string>(),
  strategy: Annotation<'simple' | 'complex' | 'none'>(),
  routeReason: Annotation<string>(),
  subQuestions: Annotation<string[]>(),
  nextSubIdx: Annotation<number>(),
  currentQuery: Annotation<string>(),
  currentHop: Annotation<number>(),
  maxHops: Annotation<number>(),
  documents: Annotation<RetrievedKnowledgeChunk[]>(),
  topDocuments: Annotation<RetrievedKnowledgeChunk[]>(),
  evidenceChunks: Annotation<RetrievedKnowledgeChunk[]>(),
  webCitations: Annotation<RagWorkflowState['webCitations']>(),
  retrievalHistory: Annotation<RetrievalHistoryItem[]>(),
  retrievalTrace: Annotation<RagWorkflowState['retrievalTrace']>(),
  plannedNext: Annotation<RagWorkflowState['plannedNext']>(),
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
  rerankLimit: Annotation<number>(),
  answerText: Annotation<string>(),
  persona: Annotation<Persona | null>(),
  history: Annotation<ConversationMessage[]>(),
});

export type RagGraphState = typeof RagGraphStateAnnotation.State;

export function getRagWorkflowCitations(
  state: Pick<RagGraphState, 'documents' | 'topDocuments' | 'evidenceChunks' | 'webCitations'>,
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
    nextSubIdx: 0,
    currentQuery: '',
    currentHop: 0,
    maxHops: input.maxHops ?? DEFAULT_RAG_MAX_HOPS,
    documents: [],
    topDocuments: [],
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    retrievalTrace: [],
    plannedNext: '',
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
    rerankLimit: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
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
    evidenceChunks:
      state.topDocuments.length > 0
        ? state.topDocuments
        : state.evidenceChunks,
    localCitations: toKnowledgeCitations(
      state.topDocuments.length > 0 ? state.topDocuments : state.evidenceChunks,
    ),
    citations: getRagWorkflowCitations(state),
  };
}
