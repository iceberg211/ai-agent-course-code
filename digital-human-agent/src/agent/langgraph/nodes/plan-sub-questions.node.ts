import type { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

export function createPlanSubQuestionsNode(
  multiHopPlannerService: MultiHopPlannerService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const plan = await multiHopPlannerService.planSubQuestions(
      state.question,
      input.signal,
    );

    return {
      subQuestions:
        plan.subQuestions.length > 0 ? plan.subQuestions : [state.question],
    } satisfies Partial<RagGraphState>;
  };
}
