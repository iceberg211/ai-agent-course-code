import { Command } from '@langchain/langgraph';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import type { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import {
  canContinueMultiHop,
  getPlannedQuestions,
  shouldUseWebFallback,
} from '@/agent/langgraph/rag.utils';

function resolveStopReason(
  state: RagGraphState,
  enough: boolean,
  webFallbackEnabled: boolean,
): string {
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
    return 'web_fallback_insufficient';
  }

  if (!shouldUseWebFallback(state, webFallbackEnabled)) {
    if (
      !state.webSearchAttempted &&
      !webFallbackEnabled &&
      (state.strategy === 'simple' || !canContinueMultiHop(state))
    ) {
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
    if (state.currentHop >= getPlannedQuestions(state).length) {
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
    const remainingSubQuestionCount =
      state.strategy === 'complex'
        ? Math.max(getPlannedQuestions(state).length - state.currentHop, 0)
        : 0;
    const evaluation = await evidenceEvaluatorService.evaluate({
      question: state.question,
      localChunks: state.evidenceChunks,
      webCitations: state.webCitations,
      currentHop: state.currentHop,
      maxHops: state.maxHops,
      remainingSubQuestionCount,
      signal: input.signal,
    });

    const update = {
      enough: evaluation.enough,
      missingFacts: evaluation.missingFacts,
      evaluationReason: evaluation.reason,
      webQuery: evaluation.webQuery,
      stopReason: resolveStopReason(
        state,
        evaluation.enough,
        webFallbackService.isEnabled(),
      ),
    } satisfies Partial<RagGraphState>;

    const nextState = {
      ...state,
      ...update,
    };

    let goto: 'prepare_query' | 'web_fallback' | 'load_context' =
      'load_context';
    if (nextState.enough) {
      goto = 'load_context';
    } else if (canContinueMultiHop(nextState)) {
      goto = 'prepare_query';
    } else if (
      shouldUseWebFallback(nextState, webFallbackService.isEnabled())
    ) {
      goto = 'web_fallback';
    }

    return new Command({
      update,
      goto,
    });
  };
}
