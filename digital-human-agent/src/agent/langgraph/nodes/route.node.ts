import { Command } from '@langchain/langgraph';
import type { RagRouteService } from '@/agent/services/rag-route.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

export function createRouteQuestionNode(ragRouteService: RagRouteService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const route = await ragRouteService.routeQuestion(
      state.question,
      input.signal,
    );

    return new Command({
      update: {
        strategy: route.strategy,
        routeReason: route.reason,
      } satisfies Partial<RagGraphState>,
      goto:
        route.strategy === 'complex' ? 'plan_sub_questions' : 'prepare_query',
    });
  };
}
