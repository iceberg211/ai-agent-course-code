import { Command } from '@langchain/langgraph';
import type { RetrievalStrategyService } from '@/agent/services/retrieval-strategy.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import { getNextQuery, getPlannedQuestions } from '@/agent/langgraph/rag.utils';

export function createRetrievalStrategyNode(
  retrievalStrategyService: RetrievalStrategyService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const currentQuery = getNextQuery(state);
    const strategy = await retrievalStrategyService.plan(
      {
        question: state.question,
        currentQuery,
        routeStrategy: state.strategy,
        remainingHops: Math.max(
          getPlannedQuestions(state).length - state.currentHop,
          0,
        ),
      },
      input.signal,
    );

    const update = {
      retrievalStrategy: strategy,
      retrievalStrategyReason: strategy.reason,
    } satisfies Partial<RagGraphState>;

    if (!strategy.needRetrieval) {
      return new Command({
        update: {
          ...update,
          retrievalHistory: [
            ...state.retrievalHistory,
            {
              query: currentQuery,
              resultCount: 0,
              skipped: true,
              reason: strategy.reason,
              strategy,
            },
          ],
          stopReason: 'retrieval_skipped',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }

    return new Command({
      update,
      goto: 'prepare_query',
    });
  };
}
