import { Command } from '@langchain/langgraph';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import type { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { RagStopReason } from '@/agent/types/rag-workflow.types';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import {
  canContinueMultiHop,
  extendSubQuestionsWithMissingFacts,
  getPlannedQuestions,
  shouldUseWebFallback,
  publishCitations,
  toWorkflowCitations,
} from '@/agent/langgraph/rag.utils';

// ==========================================
// 1. rerank 节点
// ==========================================
export function createRerankNode(rerankerService: RerankerService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const documents = state.documents;

    if (documents.length === 0) {
      return {
        topDocuments: [],
        evidenceChunks: [],
      } satisfies Partial<RagGraphState>;
    }

    const topDocuments = await rerankerService.rerank(
      state.question,
      documents,
      state.rerankLimit ?? DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
      input.signal,
    );

    publishCitations(
      input,
      toWorkflowCitations({
        documents: state.documents,
        topDocuments,
        evidenceChunks: topDocuments,
        webCitations: state.webCitations,
      }),
    );

    return {
      topDocuments,
      evidenceChunks: topDocuments,
    } satisfies Partial<RagGraphState>;
  };
}

// ==========================================
// 2. evaluate_evidence 节点
// ==========================================
function resolveStopReason(
  state: RagGraphState,
  enough: boolean,
  webFallbackEnabled: boolean,
): RagStopReason {
  if (enough) {
    if (state.webSearchUsed) {
      return 'web_fallback_enough';
    }
    if (state.strategy === 'complex' && state.currentHop > 1) {
      return 'multi_hop_enough';
    }
    return 'single_hop_enough';
  }

  if (state.webSearchUsed) {
    if (shouldUseWebFallback(state, webFallbackEnabled)) {
      return 'web_fallback_retry';
    }
    return 'web_fallback_insufficient';
  }

  const canWebSearch = shouldUseWebFallback(state, webFallbackEnabled);

  if (!canWebSearch) {
    if (!state.webSearchAttempted && !webFallbackEnabled) {
      return 'web_fallback_disabled';
    }
    if (
      state.webSearchAttempted &&
      !state.webSearchUsed &&
      state.stopReason?.length > 0
    ) {
      return state.stopReason;
    }
  }

  if (state.strategy === 'complex') {
    if (state.currentHop >= state.maxHops) {
      return 'max_hops_reached';
    }
    if (state.nextSubIdx >= getPlannedQuestions(state).length) {
      return 'sub_questions_exhausted';
    }
    return 'multi_hop_insufficient';
  }

  return 'single_hop_insufficient';
}

export function createEvaluateEvidenceNode(
  evidenceEvaluatorService: EvidenceEvaluatorService,
  webFallbackService: WebFallbackService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    if (
      !state.retrievalStrategy.needRetrieval ||
      state.stopReason === 'retrieval_skipped'
    ) {
      const reason =
        state.retrievalStrategy.reason ||
        state.retrievalStrategyReason ||
        '无需检索，跳过证据评估';

      return new Command({
        update: {
          enough: true,
          missingFacts: [],
          evaluationReason: reason,
          webQuery: '',
          stopReason: 'retrieval_skipped',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }

    const remainingSubQuestionCount =
      state.strategy === 'complex'
        ? Math.max(getPlannedQuestions(state).length - state.currentHop, 0)
        : 0;
    const evaluation = await evidenceEvaluatorService.evaluate({
      question: state.question,
      localChunks: state.topDocuments,
      webCitations: state.webCitations,
      currentHop: state.currentHop,
      maxHops: state.maxHops,
      remainingSubQuestionCount,
      signal: input.signal,
    });

    const webFallbackEnabled =
      webFallbackService.isEnabled() && state.retrievalStrategy.allowWeb;
    const plannedQuestionCount = getPlannedQuestions(state).length;
    const extendedSubQuestions = extendSubQuestionsWithMissingFacts(
      state,
      evaluation.missingFacts,
    );
    const stateForDecision = {
      ...state,
      subQuestions: extendedSubQuestions,
    };
    const update = {
      subQuestions: extendedSubQuestions,
      enough: evaluation.enough,
      missingFacts: evaluation.missingFacts,
      evaluationReason: evaluation.reason,
      webQuery: evaluation.webQuery,
      stopReason: resolveStopReason(
        stateForDecision,
        evaluation.enough,
        webFallbackEnabled,
      ),
    } satisfies Partial<RagGraphState>;

    const nextState = {
      ...state,
      ...update,
    };
    const canRetryLocalKnowledge =
      !nextState.enough &&
      extendedSubQuestions.length > plannedQuestionCount &&
      canContinueMultiHop(nextState);

    let goto: 'retrieve' | 'web_fallback' | 'load_context' = 'load_context';
    if (nextState.enough) {
      goto = 'load_context';
    } else if (canRetryLocalKnowledge) {
      goto = 'retrieve';
    } else if (shouldUseWebFallback(nextState, webFallbackEnabled)) {
      goto = 'web_fallback';
    }

    return new Command({
      update,
      goto,
    });
  };
}
