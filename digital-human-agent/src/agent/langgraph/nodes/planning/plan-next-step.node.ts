import { Command } from '@langchain/langgraph';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import { getPlannedQuestions } from '@/agent/langgraph/rag.utils';

export function createPlanNextStepNode() {
  return async (state: RagGraphState) => {
    const plannedQuestions = getPlannedQuestions(state);
    const hasRemainingQueries =
      state.strategy === 'complex' &&
      state.nextSubIdx < Math.min(state.maxHops, plannedQuestions.length);
    const plannedNext = hasRemainingQueries ? 'retrieve' : 'rerank';

    return new Command({
      update: {
        plannedNext,
      } satisfies Partial<RagGraphState>,
      goto: plannedNext,
    });
  };
}
