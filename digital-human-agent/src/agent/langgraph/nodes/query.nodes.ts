import { Command } from '@langchain/langgraph';
import { isAbortError } from '@/common/utils';
import { WebFallbackService } from '@/agent/services/web-fallback.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import {
  capCandidateDocuments,
  getNextQuery,
  mergeEvidenceChunks,
  publishCitations,
  toWorkflowCitations,
  mergeWebCitations,
  shouldStopRetrievalBudget,
} from '@/agent/langgraph/rag.utils';
import {
  isBeforeFinalRetryAttempt,
  isTransientRagDependencyError,
} from '@/agent/langgraph/rag.retry-policy';
import { RetrievalPolicyResolver } from '@/agent/services/retrieval-policy.resolver';
import type {
  RetrievalPort,
  RetrievalPortResponse,
} from '@/knowledge/services/retrieval/pipeline/retrieval-port';
import type { RetrievalQueryItem } from '@/knowledge/types/knowledge-content.types';
import { extractFallbackKeywordTerms } from '@/knowledge/utils/keyword.utils';
import {
  addTurnDegradation,
  withRemainingTurnTimeout,
} from '@/common/rag/turn-budget.context';

// ==========================================
// 1. retrieve 节点（经 RetrievalPort：hybrid + 可选 graph expand）
// ==========================================
export function createRetrieveNode(
  retrievalPolicyResolver: RetrievalPolicyResolver,
  retrievalPort: RetrievalPort,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    if (shouldStopRetrievalBudget(state)) {
      return {
        stopReason: 'max_hops_reached',
      } satisfies Partial<RagGraphState>;
    }
    const currentQuery = getNextQuery(state);

    if (!currentQuery) {
      return {};
    }

    // 首跳完整 policy；后续 hop 复用策略，仅换 query（避免重复 rewrite LLM）
    let hopStrategy = state.retrievalStrategy;
    let retrievalQueries: RetrievalQueryItem[] = [];
    let retrievalStrategyReason = state.retrievalStrategyReason;
    let routeAllowWeb = state.routeAllowWeb;

    if (state.currentHop === 0) {
      const augmentation = await retrievalPolicyResolver.resolve({
        question: currentQuery,
        routeStrategy: state.strategy,
        profileId: state.profileId ?? input.profileId,
        history: state.queryHistory ?? [],
        signal: input.signal,
      });
      routeAllowWeb = augmentation.strategy.allowWeb !== false;
      hopStrategy = {
        ...augmentation.strategy,
        allowWeb: routeAllowWeb,
      };
      retrievalQueries = augmentation.retrievalQueries;
      retrievalStrategyReason = hopStrategy.reason;
    } else {
      hopStrategy = {
        ...state.retrievalStrategy,
        allowWeb: state.routeAllowWeb,
      };
      retrievalQueries = [
        {
          index: 0,
          query: currentQuery,
          keywords: extractFallbackKeywordTerms(currentQuery),
          angle: 'detail',
        },
      ];
    }

    const update = {
      currentQuery,
      retrievalStrategy: hopStrategy,
      retrievalStrategyReason,
      routeAllowWeb,
      currentHop: state.currentHop + 1,
      nextSubIdx: state.nextSubIdx + 1,
      topDocuments: [],
    } satisfies Partial<RagGraphState>;

    if (!hopStrategy.needRetrieval || retrievalQueries.length === 0) {
      return {
        ...update,
        retrievalHistory: [
          ...state.retrievalHistory,
          {
            query: currentQuery,
            resultCount: 0,
            skipped: true,
            reason: hopStrategy.reason,
            strategy: hopStrategy,
          },
        ],
        stopReason: 'retrieval_skipped',
      } satisfies Partial<RagGraphState>;
    }

    let stage1Result: RetrievalPortResponse;
    try {
      stage1Result = await withRemainingTurnTimeout(
        'rag_retrieval_port',
        (childSignal) =>
          retrievalPort.retrieve({
            personaId: input.personaId,
            retrievalQueries,
            strategy: hopStrategy,
            accessScope: input.accessScope,
            signal: childSignal,
            graphExpand:
              state.useGraphExpand === true && hopStrategy.useGraph === true,
            question: state.question,
            currentQuery,
            profileId: state.profileId ?? input.profileId,
          }),
        input.signal,
      );
    } catch (error) {
      if (isAbortError(error) && input.signal.aborted) {
        throw error;
      }
      if (
        isTransientRagDependencyError(error) &&
        isBeforeFinalRetryAttempt(config.executionInfo?.nodeAttempt)
      ) {
        throw error;
      }
      addTurnDegradation('retrieval_timeout_or_failed');
      return {
        ...update,
        documents: state.documents,
        evidenceChunks: state.documents,
        retrievalHistory: [
          ...state.retrievalHistory,
          {
            query: currentQuery,
            resultCount: 0,
            reason: error instanceof Error ? error.message : String(error),
            strategy: hopStrategy,
          },
        ],
        stopReason: 'max_hops_reached',
      } satisfies Partial<RagGraphState>;
    }

    const documents = capCandidateDocuments(
      mergeEvidenceChunks(state.documents, stage1Result.chunks),
    );

    // 不在粗召回阶段推 citations，避免前端闪变；正式引用在 rerank 后发布

    return {
      ...update,
      documents,
      evidenceChunks: documents,
      retrievalTrace: [...state.retrievalTrace, ...stage1Result.trace],
      graphReasoningTrace: [
        ...(state.graphReasoningTrace ?? []),
        ...(stage1Result.graphExpandTrace ?? []),
      ],
      retrievalHistory: [
        ...state.retrievalHistory,
        {
          query: currentQuery,
          resultCount: stage1Result.chunks.length,
          strategy: hopStrategy,
        },
      ],
      stopReason: '',
      rerankLimit: stage1Result.rerankLimit ?? state.rerankLimit,
    } satisfies Partial<RagGraphState>;
  };
}

// ==========================================
// 2. web_fallback 节点
// ==========================================
export function createWebFallbackNode(webFallbackService: WebFallbackService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);

    if (shouldStopRetrievalBudget(state)) {
      return new Command({
        update: {
          stopReason: 'max_hops_reached',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }

    if (!webFallbackService.isEnabled()) {
      return new Command({
        update: {
          stopReason: 'web_fallback_disabled',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }

    const webQuery = state.webQuery.trim() || state.question;
    const previousAttempts = Number.isFinite(state.webSearchAttempts)
      ? state.webSearchAttempts
      : state.webSearchAttempted
        ? 1
        : 0;
    const webSearchAttempts = previousAttempts + 1;
    const webSearchQueries = Array.from(
      new Set([...(state.webSearchQueries ?? []), webQuery]),
    );

    try {
      const webCitations = await withRemainingTurnTimeout(
        'rag_web_fallback',
        (childSignal) =>
          webFallbackService.search({
            query: webQuery,
            signal: childSignal,
          }),
        input.signal,
      );

      if (webCitations.length === 0) {
        return new Command({
          update: {
            webQuery,
            webSearchAttempted: true,
            webSearchAttempts,
            webSearchQueries,
            stopReason: 'web_fallback_empty',
          } satisfies Partial<RagGraphState>,
          goto: 'load_context',
        });
      }

      const mergedWebCitations = mergeWebCitations(
        state.webCitations,
        webCitations,
      );

      publishCitations(
        input,
        toWorkflowCitations({
          documents: state.documents,
          topDocuments: state.topDocuments,
          evidenceChunks: state.topDocuments,
          webCitations: mergedWebCitations,
        }),
      );

      return new Command({
        update: {
          webQuery,
          webSearchAttempted: true,
          webSearchAttempts,
          webSearchQueries,
          webCitations: mergedWebCitations,
          webSearchUsed: true,
        } satisfies Partial<RagGraphState>,
        goto: 'evaluate_evidence',
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (
        isTransientRagDependencyError(error) &&
        isBeforeFinalRetryAttempt(config.executionInfo?.nodeAttempt)
      ) {
        throw error;
      }

      return new Command({
        update: {
          webQuery,
          webSearchAttempted: true,
          webSearchAttempts,
          webSearchQueries,
          stopReason: 'web_fallback_failed',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }
  };
}
