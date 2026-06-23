import { Command } from '@langchain/langgraph';
import type { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import type { RagRouteService } from '@/agent/services/rag-route.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import { getPlannedQuestions } from '@/agent/langgraph/rag.utils';

// ==========================================
// 1. route_question 节点
// ==========================================
export function createRouteQuestionNode(ragRouteService: RagRouteService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const route = await ragRouteService.routeQuestion(
      state.question,
      input.signal,
    );

    let goto: 'plan_sub_questions' | 'retrieve' | 'generate_answer' = 'retrieve';
    if (route.strategy === 'none') {
      goto = 'generate_answer';
    } else if (route.strategy === 'complex') {
      goto = 'plan_sub_questions';
    }

    return new Command({
      update: {
        strategy: route.strategy,
        routeReason: route.reason,
      } satisfies Partial<RagGraphState>,
      goto,
    });
  };
}

// ==========================================
// 2. plan_sub_questions 节点
// ==========================================
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

// ==========================================
// 3. plan_next_step 节点
// ==========================================
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
