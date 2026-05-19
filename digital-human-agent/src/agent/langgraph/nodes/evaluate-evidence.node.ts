import { Command } from '@langchain/langgraph';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import type { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { RagStopReason } from '@/agent/types/rag-workflow.types';
import {
  getPlannedQuestions,
  shouldUseWebFallback,
} from '@/agent/langgraph/rag.utils';

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

  if (!shouldUseWebFallback(state, webFallbackEnabled)) {
    if (!state.webSearchAttempted && !webFallbackEnabled) {
      return 'web_fallback_disabled';
    }

    if (
      state.webSearchAttempted &&
      !state.webSearchUsed &&
      state.stopReason.length > 0
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

  if (shouldUseWebFallback(state, webFallbackEnabled)) {
    return 'single_hop_insufficient';
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
    const update = {
      enough: evaluation.enough,
      missingFacts: evaluation.missingFacts,
      evaluationReason: evaluation.reason,
      webQuery: evaluation.webQuery,
      stopReason: resolveStopReason(
        state,
        evaluation.enough,
        webFallbackEnabled,
      ),
    } satisfies Partial<RagGraphState>;

    const nextState = {
      ...state,
      ...update,
    };

    let goto: 'web_fallback' | 'load_context' = 'load_context';
    if (nextState.enough) {
      goto = 'load_context';
    } else if (shouldUseWebFallback(nextState, webFallbackEnabled)) {
      goto = 'web_fallback';
    }

    return new Command({
      update,
      goto,
    });
  };
}
