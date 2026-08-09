import { Command } from '@langchain/langgraph';
import type { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import type { RagRouteService } from '@/agent/services/rag-route.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

// ==========================================
// 1. route_question 节点
// ==========================================
export function createRouteQuestionNode(ragRouteService: RagRouteService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const route = await ragRouteService.routeQuestion(
      state.question,
      input.signal,
      { mode: state.routeMode },
    );

    // none：加载 persona 后轻量生成（跳过记忆与检索，保留人设）
    // complex：先规划子问题，再加载记忆并进入 retrieve 循环
    // simple：加载记忆后进入 retrieve 循环
    let goto:
      | 'plan_sub_questions'
      | 'load_query_history'
      | 'load_context' = 'load_query_history';
    if (route.strategy === 'none') {
      goto = 'load_context';
    } else if (route.strategy === 'complex') {
      goto = 'plan_sub_questions';
    } else {
      goto = 'load_query_history';
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
