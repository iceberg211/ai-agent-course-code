import { END, START, StateGraph } from '@langchain/langgraph';
import type { AnswerGenerationService } from '@/agent/services/generation/answer-generation.service';
import type { EvidenceEvaluatorService } from '@/agent/services/evaluation/evidence-evaluator.service';
import type { MultiHopPlannerService } from '@/agent/services/planning/multi-hop-planner.service';
import type { QueryAugmentationService } from '@/agent/services/query/query-augmentation.service';
import type { RagRouteService } from '@/agent/services/planning/rag-route.service';
import type { WebFallbackService } from '@/agent/services/query/web-fallback.service';
import { RagGraphContextAnnotation } from '@/agent/langgraph/rag.context';
import { createEvaluateEvidenceNode } from '@/agent/langgraph/nodes/evaluation/evaluate-evidence.node';
import { createPlanNextStepNode } from '@/agent/langgraph/nodes/planning/plan-next-step.node';
import { RAG_DEPENDENCY_RETRY_POLICY } from '@/agent/langgraph/rag.retry-policy';
import { createGenerateAnswerNode } from '@/agent/langgraph/nodes/generation/generate-answer.node';
import { createLoadContextNode } from '@/agent/langgraph/nodes/generation/load-context.node';
import { createPlanSubQuestionsNode } from '@/agent/langgraph/nodes/planning/plan-sub-questions.node';
import { createRerankNode } from '@/agent/langgraph/nodes/evaluation/rerank.node';
import { createRetrieveNode } from '@/agent/langgraph/nodes/query/retrieve.node';
import { createRouteQuestionNode } from '@/agent/langgraph/nodes/planning/route.node';
import { createWebFallbackNode } from '@/agent/langgraph/nodes/query/web-fallback.node';
import { RagGraphStateAnnotation } from '@/agent/langgraph/rag.state';
import type { ConversationService } from '@/conversation/services/conversation.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import type { PersonaService } from '@/persona/persona.service';

export interface RagGraphDeps {
  personaHybridRetrieverService: HybridRetrieverService;
  personaService: PersonaService;
  conversationService: ConversationService;
  answerGenerationService: AnswerGenerationService;
  ragRouteService: RagRouteService;
  queryAugmentationService: QueryAugmentationService;
  multiHopPlannerService: MultiHopPlannerService;
  rerankerService: RerankerService;
  evidenceEvaluatorService: EvidenceEvaluatorService;
  webFallbackService: WebFallbackService;
}

export function buildRagGraph(deps: RagGraphDeps) {
  return new StateGraph(RagGraphStateAnnotation, RagGraphContextAnnotation)
    .addNode('route_question', createRouteQuestionNode(deps.ragRouteService), {
      ends: ['retrieve', 'plan_sub_questions', 'generate_answer'],
    })
    .addNode(
      'plan_sub_questions',
      createPlanSubQuestionsNode(deps.multiHopPlannerService),
    )
    .addNode(
      'retrieve',
      createRetrieveNode(
        deps.queryAugmentationService,
        deps.personaHybridRetrieverService,
      ),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode('plan_next_step', createPlanNextStepNode(), {
      ends: ['retrieve', 'rerank'],
    })
    .addNode(
      'rerank',
      createRerankNode(deps.rerankerService),
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
        ends: ['retrieve', 'web_fallback', 'load_context'],
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
    .addEdge('plan_sub_questions', 'retrieve')
    .addEdge('retrieve', 'plan_next_step')
    .addEdge('rerank', 'evaluate_evidence')
    .addEdge('load_context', 'generate_answer')
    .addEdge('generate_answer', END)
    .compile();
}

export type RagGraph = ReturnType<typeof buildRagGraph>;
