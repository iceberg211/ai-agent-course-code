import { END, START, StateGraph } from '@langchain/langgraph';
import type { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import type { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import type { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import type { RagRouteService } from '@/agent/services/rag-route.service';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import { RagGraphContextAnnotation } from '@/agent/langgraph/rag.context';
import { createEvaluateEvidenceNode, createRerankNode } from '@/agent/langgraph/nodes/evaluation.nodes';
import { createPlanSubQuestionsNode, createRouteQuestionNode } from '@/agent/langgraph/nodes/planning.nodes';
import { RAG_DEPENDENCY_RETRY_POLICY } from '@/agent/langgraph/rag.retry-policy';
import {
  createGenerateAnswerNode,
  createLoadContextNode,
  createLoadQueryHistoryNode,
} from '@/agent/langgraph/nodes/generation.nodes';
import { createRetrieveNode, createWebFallbackNode } from '@/agent/langgraph/nodes/query.nodes';
import {
  createLoadGenerationMemoryNode,
  createMergeMemoryContextNode,
} from '@/agent/langgraph/nodes/memory.nodes';
import { RagGraphStateAnnotation } from '@/agent/langgraph/rag.state';
import type { ConversationService } from '@/conversation/services/conversation.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import type { PersonaService } from '@/persona/persona.service';
import type { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import type { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import type { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import type { RetrievalPolicyResolver } from '@/agent/services/retrieval-policy.resolver';
import type { RetrievalPort } from '@/knowledge/services/retrieval/pipeline/retrieval-port';

export interface RagGraphDeps {
  retrievalPort: RetrievalPort;
  personaService: PersonaService;
  conversationService: ConversationService;
  answerGenerationService: AnswerGenerationService;
  ragRouteService: RagRouteService;
  retrievalPolicyResolver: RetrievalPolicyResolver;
  multiHopPlannerService: MultiHopPlannerService;
  rerankerService: RerankerService;
  evidenceEvaluatorService: EvidenceEvaluatorService;
  webFallbackService: WebFallbackService;
  shortTermMemoryService: ShortTermMemoryService;
  memoryRetrieverService: MemoryRetrieverService;
  memoryPolicyService: MemoryPolicyService;
}

/**
 * RAG 运行时图：
 * 1. 先 route
 * 2. retrieve 经 RetrievalPort（hybrid + 可选 graph expand）
 * 3. rerank → evaluate，enough early-stop
 */
export function buildRagGraph(deps: RagGraphDeps) {
  return new StateGraph(RagGraphStateAnnotation, RagGraphContextAnnotation)
    .addNode('route_question', createRouteQuestionNode(deps.ragRouteService), {
      ends: ['load_query_history', 'plan_sub_questions', 'load_context'],
    })
    .addNode(
      'plan_sub_questions',
      createPlanSubQuestionsNode(deps.multiHopPlannerService),
    )
    .addNode(
      'load_query_history',
      createLoadQueryHistoryNode(deps.conversationService),
      { retryPolicy: RAG_DEPENDENCY_RETRY_POLICY },
    )
    .addNode(
      'load_generation_memory',
      createLoadGenerationMemoryNode(
        deps.shortTermMemoryService,
        deps.memoryRetrieverService,
        deps.memoryPolicyService,
      ),
      { retryPolicy: RAG_DEPENDENCY_RETRY_POLICY },
    )
    .addNode(
      'retrieve',
      createRetrieveNode(deps.retrievalPolicyResolver, deps.retrievalPort),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode('rerank', createRerankNode(deps.rerankerService), {
      retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
    })
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
        ends: ['load_generation_memory', 'generate_answer'],
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode('merge_memory_context', createMergeMemoryContextNode())
    .addNode(
      'generate_answer',
      createGenerateAnswerNode(deps.answerGenerationService),
    )
    .addEdge(START, 'route_question')
    .addEdge('plan_sub_questions', 'load_query_history')
    .addEdge('load_query_history', 'retrieve')
    .addEdge('load_generation_memory', 'merge_memory_context')
    .addEdge('retrieve', 'rerank')
    .addEdge('rerank', 'evaluate_evidence')
    .addEdge('merge_memory_context', 'generate_answer')
    .addEdge('generate_answer', END)
    .compile();
}

export type RagGraph = ReturnType<typeof buildRagGraph>;
