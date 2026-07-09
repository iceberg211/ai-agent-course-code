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
import { createGenerateAnswerNode, createLoadContextNode } from '@/agent/langgraph/nodes/generation.nodes';
import { createRetrieveNode, createWebFallbackNode, createGraphReasoningNode } from '@/agent/langgraph/nodes/query.nodes';
import {
  createFilterMemoryByPolicyNode,
  createLoadShortTermMemoryNode,
  createMergeMemoryContextNode,
  createRetrieveLongTermMemoryNode,
} from '@/agent/langgraph/nodes/memory.nodes';
import { RagGraphStateAnnotation } from '@/agent/langgraph/rag.state';
import type { ConversationService } from '@/conversation/services/conversation.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import type { PersonaService } from '@/persona/persona.service';
import type { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import type { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import type { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import type { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import type { RetrievalPolicyResolver } from '@/agent/services/retrieval-policy.resolver';

export interface RagGraphDeps {
  personaHybridRetrieverService: HybridRetrieverService;
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
  knowledgeGraphService: KnowledgeGraphService;
}

/**
 * RAG 运行时图（性能友好编排）：
 * 1. 先 route：none 直接生成，避免无谓的记忆/检索开销
 * 2. 每 hop：retrieve → graph → rerank → evaluate，enough 则 early-stop
 * 3. 多跳仅通过 evaluate → retrieve 继续，不再“先全量检索再统一评估”
 */
export function buildRagGraph(deps: RagGraphDeps) {
  return new StateGraph(RagGraphStateAnnotation, RagGraphContextAnnotation)
    .addNode('route_question', createRouteQuestionNode(deps.ragRouteService), {
      ends: ['load_short_term_memory', 'plan_sub_questions', 'generate_answer'],
    })
    .addNode(
      'plan_sub_questions',
      createPlanSubQuestionsNode(deps.multiHopPlannerService),
    )
    .addNode(
      'load_short_term_memory',
      createLoadShortTermMemoryNode(deps.shortTermMemoryService),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode(
      'retrieve_long_term_memory',
      createRetrieveLongTermMemoryNode(deps.memoryRetrieverService),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode(
      'filter_memory_by_policy',
      createFilterMemoryByPolicyNode(deps.memoryPolicyService),
    )
    .addNode(
      'retrieve',
      createRetrieveNode(
        deps.retrievalPolicyResolver,
        deps.personaHybridRetrieverService,
      ),
      {
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode(
      'graph_reasoning',
      createGraphReasoningNode(deps.knowledgeGraphService),
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
        retryPolicy: RAG_DEPENDENCY_RETRY_POLICY,
      },
    )
    .addNode('merge_memory_context', createMergeMemoryContextNode())
    .addNode(
      'generate_answer',
      createGenerateAnswerNode(deps.answerGenerationService),
    )
    .addEdge(START, 'route_question')
    .addEdge('plan_sub_questions', 'load_short_term_memory')
    .addEdge('load_short_term_memory', 'retrieve_long_term_memory')
    .addEdge('retrieve_long_term_memory', 'filter_memory_by_policy')
    .addEdge('filter_memory_by_policy', 'retrieve')
    .addEdge('retrieve', 'graph_reasoning')
    .addEdge('graph_reasoning', 'rerank')
    .addEdge('rerank', 'evaluate_evidence')
    .addEdge('load_context', 'merge_memory_context')
    .addEdge('merge_memory_context', 'generate_answer')
    .addEdge('generate_answer', END)
    .compile();
}

export type RagGraph = ReturnType<typeof buildRagGraph>;
