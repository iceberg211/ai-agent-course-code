import { Command } from '@langchain/langgraph';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import {
  buildFallbackEvaluation,
  type EvidenceEvaluatorService,
} from '@/agent/services/evidence-evaluator.service';
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
  getCurrentQuery,
  getPlannedQuestions,
  shouldStopRetrievalBudget,
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

    const topK =
      state.retrievalStrategy?.rerankTopK ??
      state.rerankLimit ??
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit;
    const minScore = state.retrievalStrategy?.minRerankScore;
    const rerankMode = state.rerankMode ?? 'llm';

    // 多跳时用当前 hop 查询句重排，同时保留原始问题以覆盖整体意图
    const currentQuery = getCurrentQuery(state);
    const rerankQuery =
      currentQuery && currentQuery !== state.question
        ? `${state.question}\n当前检索焦点：${currentQuery}`
        : state.question;

    const topDocuments = await rerankerService.rerank(
      rerankQuery,
      documents,
      topK,
      input.signal,
      minScore,
      rerankMode,
    );

    // 正式 citations：仅在重排后推送，避免粗召回闪变
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
    if (state.currentHop > 1) {
      return 'multi_hop_enough';
    }
    return 'single_hop_enough';
  }

  if (shouldStopRetrievalBudget(state)) {
    return 'max_hops_reached';
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

  if (state.currentHop >= state.maxHops) {
    return 'max_hops_reached';
  }
  if (state.nextSubIdx >= getPlannedQuestions(state).length) {
    return state.strategy === 'complex'
      ? 'sub_questions_exhausted'
      : 'single_hop_insufficient';
  }
  if (state.strategy === 'complex' || state.currentHop > 1) {
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

    // 预算耗尽（wall-clock 或 llm/embed）：直接进入生成，不再 hop / web
    if (shouldStopRetrievalBudget(state)) {
      return new Command({
        update: {
          enough: false,
          missingFacts: state.missingFacts,
          evaluationReason: '工作流预算已用尽，停止继续检索',
          webQuery: '',
          stopReason: 'max_hops_reached',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }

    // complex 与 simple 补 hop 统一用剩余子问题数提示评估器
    const remainingSubQuestionCount = Math.max(
      getPlannedQuestions(state).length - state.currentHop,
      0,
    );

    const evaluateMode = state.evaluateMode ?? 'llm';
    let evaluation: {
      enough: boolean;
      missingFacts: string[];
      reason: string;
      webQuery: string;
    };

    if (evaluateMode === 'off') {
      evaluation = {
        enough: state.topDocuments.length > 0,
        missingFacts: [],
        reason: 'evaluateMode=off，跳过充分性评估',
        webQuery: '',
      };
    } else if (evaluateMode === 'heuristic') {
      evaluation = buildFallbackEvaluation({
        question: state.question,
        localChunks: state.topDocuments,
        webCitations: state.webCitations,
        currentHop: state.currentHop,
        maxHops: state.maxHops,
        remainingSubQuestionCount,
        signal: input.signal,
      });
    } else {
      evaluation = await evidenceEvaluatorService.evaluate({
        question: state.question,
        localChunks: state.topDocuments,
        webCitations: state.webCitations,
        currentHop: state.currentHop,
        maxHops: state.maxHops,
        remainingSubQuestionCount,
        signal: input.signal,
      });
    }

    const webFallbackEnabled =
      webFallbackService.isEnabled() &&
      state.routeAllowWeb !== false &&
      state.retrievalStrategy.allowWeb !== false;
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
    // hop early-stop：enough 则停；否则在 hop 预算内继续本地检索（含 complex 预规划与 missingFacts 扩展）
    const canRetryLocalKnowledge =
      !nextState.enough &&
      !shouldStopRetrievalBudget(nextState) &&
      canContinueMultiHop(nextState);

    let goto: 'retrieve' | 'web_fallback' | 'load_context' = 'load_context';
    if (nextState.enough) {
      goto = 'load_context';
    } else if (canRetryLocalKnowledge) {
      goto = 'retrieve';
    } else if (
      !shouldStopRetrievalBudget(nextState) &&
      shouldUseWebFallback(nextState, webFallbackEnabled)
    ) {
      goto = 'web_fallback';
    }

    return new Command({
      update,
      goto,
    });
  };
}

