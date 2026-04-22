import { Command } from '@langchain/langgraph';
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
            stopReason: 'web_fallback_empty',
          } satisfies Partial<RagGraphState>,
          goto: 'load_context',
        });
      }

      publishCitations(
        input,
        toWorkflowCitations({
          evidenceChunks: state.evidenceChunks,
          webCitations,
        } as Pick<RagGraphState, 'evidenceChunks' | 'webCitations'>),
      );

      return new Command({
        update: {
          webQuery,
          webSearchAttempted: true,
          webCitations,
          webSearchUsed: true,
        } satisfies Partial<RagGraphState>,
        goto: 'evaluate_evidence',
      });
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
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
          stopReason: 'web_fallback_failed',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }
  };
}
