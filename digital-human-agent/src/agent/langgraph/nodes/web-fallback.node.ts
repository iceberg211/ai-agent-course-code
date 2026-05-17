import { Command } from '@langchain/langgraph';
import { isAbortError } from '@/common/utils';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import {
  isBeforeFinalRetryAttempt,
  isTransientRagDependencyError,
} from '@/agent/langgraph/rag.retry-policy';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import {
  mergeWebCitations,
  publishCitations,
  toWorkflowCitations,
} from '@/agent/langgraph/rag.utils';

export function createWebFallbackNode(webFallbackService: WebFallbackService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);

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
      const webCitations = await webFallbackService.search({
        query: webQuery,
        signal: input.signal,
      });

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
          evidenceChunks: state.evidenceChunks,
          webCitations: mergedWebCitations,
        } as Pick<RagGraphState, 'evidenceChunks' | 'webCitations'>),
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
