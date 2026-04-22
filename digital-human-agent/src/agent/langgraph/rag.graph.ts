import { END, START, StateGraph } from '@langchain/langgraph';
import type { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import type { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import type { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import type { RagRouteService } from '@/agent/services/rag-route.service';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import { RagGraphContextAnnotation } from '@/agent/langgraph/rag.context';
import { createEvaluateEvidenceNode } from '@/agent/langgraph/nodes/evaluate-evidence.node';
import { RAG_DEPENDENCY_RETRY_POLICY } from '@/agent/langgraph/rag.retry-policy';
import { createGenerateAnswerNode } from '@/agent/langgraph/nodes/generate-answer.node';
import { createLoadContextNode } from '@/agent/langgraph/nodes/load-context.node';
import { createPlanSubQuestionsNode } from '@/agent/langgraph/nodes/plan-sub-questions.node';
import {
  createPrepareQueryNode,
  createRetrieveEvidenceNode,
} from '@/agent/langgraph/nodes/retrieve.node';
import { createRouteQuestionNode } from '@/agent/langgraph/nodes/route.node';
import { createWebFallbackNode } from '@/agent/langgraph/nodes/web-fallback.node';
import { RagGraphStateAnnotation } from '@/agent/langgraph/rag.state';
import type { ConversationService } from '@/conversation/conversation.service';
import type { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type { PersonaService } from '@/persona/persona.service';

export interface RagGraphDeps {
  knowledgeSearchService: KnowledgeSearchService;
  personaService: PersonaService;
  conversationService: ConversationService;
  answerGenerationService: AnswerGenerationService;
  ragRouteService: RagRouteService;
  multiHopPlannerService: MultiHopPlannerService;
  evidenceEvaluatorService: EvidenceEvaluatorService;
  webFallbackService: WebFallbackService;
}

export function buildRagGraph(deps: RagGraphDeps) {
  return new StateGraph(RagGraphStateAnnotation, RagGraphContextAnnotation)
    .addNode('route_question', createRouteQuestionNode(deps.ragRouteService), {
      ends: ['prepare_query', 'plan_sub_questions'],
    })
    .addNode(
      'plan_sub_questions',
      createPlanSubQuestionsNode(deps.multiHopPlannerService),
    )
    .addNode('prepare_query', createPrepareQueryNode(deps.webFallbackService), {
      ends: ['retrieve_evidence', 'web_fallback', 'load_context'],
    })
    .addNode(
      'retrieve_evidence',
      createRetrieveEvidenceNode(deps.knowledgeSearchService),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode(
      'evaluate_evidence',
      createEvaluateEvidenceNode(
        deps.evidenceEvaluatorService,
        deps.webFallbackService,
      ),
      {
        ends: ['prepare_query', 'web_fallback', 'load_context'],
      },
    )
    .addNode('web_fallback', createWebFallbackNode(deps.webFallbackService), {
      ends: ['evaluate_evidence', 'load_context'],
      retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
    })
    .addNode(
      'load_context',
      createLoadContextNode(deps.personaService, deps.conversationService),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode(
      'generate_answer',
      createGenerateAnswerNode(deps.answerGenerationService),
    )
    .addEdge(START, 'route_question')
    .addEdge('plan_sub_questions', 'prepare_query')
    .addEdge('retrieve_evidence', 'evaluate_evidence')
    .addEdge('load_context', 'generate_answer')
    .addEdge('generate_answer', END)
    .compile();
}

export type RagGraph = ReturnType<typeof buildRagGraph>;
