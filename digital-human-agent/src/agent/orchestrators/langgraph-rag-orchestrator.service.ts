import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { throwIfAborted } from '@/common/utils';
import { type RagGraph, buildRagGraph } from '@/agent/langgraph/rag.graph';
import {
  buildInitialRagGraphState,
  getRagWorkflowCitations,
  toRagWorkflowState,
} from '@/agent/langgraph/rag.state';
import { normalizePromptHistory } from '@/agent/langgraph/nodes/generation.nodes';
import { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import { RagRouteService } from '@/agent/services/rag-route.service';
import { WebFallbackService } from '@/agent/services/web-fallback.service';
import type {
  RagOrchestrator,
  RagWorkflowInput,
  RagWorkflowResult,
} from '@/agent/types/rag-workflow.types';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import { ConversationService } from '@/conversation/services/conversation.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import { PersonaService } from '@/persona/persona.service';
import { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { RetrievalPolicyResolver } from '@/agent/services/retrieval-policy.resolver';
import { getRagProfile } from '@/common/rag/rag-profile';
import {
  runWithTurnBudget,
  TurnBudgetContext,
  getTurnBudget,
} from '@/common/rag/turn-budget.context';

@Injectable()
export class LangGraphRagOrchestratorService
  implements RagOrchestrator, OnModuleInit
{
  private readonly logger = new Logger(LangGraphRagOrchestratorService.name);
  private graph: RagGraph;

  constructor(
    private readonly personaHybridRetrieverService: HybridRetrieverService,
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    private readonly answerGenerationService: AnswerGenerationService,
    private readonly ragRouteService: RagRouteService,
    private readonly retrievalPolicyResolver: RetrievalPolicyResolver,
    private readonly multiHopPlannerService: MultiHopPlannerService,
    private readonly rerankerService: RerankerService,
    private readonly evidenceEvaluatorService: EvidenceEvaluatorService,
    private readonly webFallbackService: WebFallbackService,
    @Optional()
    private readonly shortTermMemoryService: ShortTermMemoryService,
    @Optional()
    private readonly memoryRetrieverService: MemoryRetrieverService,
    @Optional()
    private readonly memoryPolicyService: MemoryPolicyService,
    @Optional()
    private readonly knowledgeGraphService?: KnowledgeGraphService,
  ) {}

  onModuleInit(): void {
    try {
      this.compileGraph();
      this.logger.log('LangGraph RAG Graph compiled successfully.');
    } catch (error) {
      this.logger.error('Failed to compile LangGraph RAG Graph', error);
      throw error;
    }
  }

  private compileGraph(): void {
    this.graph = buildRagGraph({
      personaHybridRetrieverService: this.personaHybridRetrieverService,
      personaService: this.personaService,
      conversationService: this.conversationService,
      answerGenerationService: this.answerGenerationService,
      ragRouteService: this.ragRouteService,
      retrievalPolicyResolver: this.retrievalPolicyResolver,
      multiHopPlannerService: this.multiHopPlannerService,
      rerankerService: this.rerankerService,
      evidenceEvaluatorService: this.evidenceEvaluatorService,
      webFallbackService: this.webFallbackService,
      shortTermMemoryService:
        this.shortTermMemoryService ??
        ({
          getContext: async () => ({
            window: [],
            summary: '',
            activeContext: '',
          }),
        } as unknown as ShortTermMemoryService),
      memoryRetrieverService:
        this.memoryRetrieverService ??
        ({
          retrieve: async () => [],
        } as unknown as MemoryRetrieverService),
      memoryPolicyService:
        this.memoryPolicyService ??
        ({
          filterReadable: (items: any[]) => items,
        } as MemoryPolicyService),
      knowledgeGraphService:
        this.knowledgeGraphService ??
        ({
          isEnabled: () => false,
        } as unknown as KnowledgeGraphService),
    });
  }

  async run(input: RagWorkflowInput): Promise<RagWorkflowResult> {
    if (!this.graph) {
      this.compileGraph();
    }

    const profile = getRagProfile(input.profileId);
    const resolvedInput: RagWorkflowInput = {
      ...input,
      profileId: profile.id,
      maxHops: input.maxHops ?? profile.maxHops,
    };

    const budget = new TurnBudgetContext({
      wallClockMs: profile.budget.wallClockMs,
      maxLlmCalls: profile.budget.maxLlmCalls,
      maxEmbedCalls: profile.budget.maxEmbedCalls,
    });

    return runWithTurnBudget(budget, () =>
      runInTracedScope(
        {
          name: 'langgraph_rag_orchestrator',
          runType: 'chain',
          tags: ['agent', 'rag', 'orchestrator', 'langgraph', profile.id],
          metadata: {
            conversationId: resolvedInput.conversationId,
            personaId: resolvedInput.personaId,
            turnId: resolvedInput.turnId,
            orchestrator: 'langgraph',
            profileId: profile.id,
          },
          input: {
            conversationId: resolvedInput.conversationId,
            personaId: resolvedInput.personaId,
            turnId: resolvedInput.turnId,
            question: resolvedInput.question,
            maxHops: resolvedInput.maxHops,
            profileId: profile.id,
          },
          outputProcessor: (output) => ({
            strategy: output.state.strategy,
            routeReason: output.state.routeReason,
            currentHop: output.state.currentHop,
            nextSubIdx: output.state.nextSubIdx,
            subQuestionCount: output.state.subQuestions.length,
            subQuestions: output.state.subQuestions,
            localDocumentCount: output.state.topDocuments.length,
            citationCount: output.citations.length,
            webCitationCount: output.state.webCitations.length,
            webSearchUsed: output.state.webSearchUsed,
            stopReason: output.state.stopReason,
            routeAllowWeb: output.state.routeAllowWeb,
            profileId: output.profileId ?? profile.id,
            orchestrator: output.state.orchestrator,
            llmCalls: getTurnBudget()?.llmCalls,
            embedCalls: getTurnBudget()?.embedCalls,
            firstTokenLatencyMs: getTurnBudget()?.firstTokenLatencyMs,
          }),
        },
        async () => {
          throwIfAborted(resolvedInput.signal);
          const initialHistory = normalizePromptHistory(
            await this.conversationService.getCompletedMessages(
              resolvedInput.conversationId,
              10,
            ),
            resolvedInput.turnId,
          );
          throwIfAborted(resolvedInput.signal);

          const finalState = await this.graph.invoke(
            buildInitialRagGraphState(resolvedInput, initialHistory),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'langgraph_rag_workflow',
                tags: ['agent', 'rag', 'langgraph', profile.id],
                metadata: {
                  conversationId: resolvedInput.conversationId,
                  personaId: resolvedInput.personaId,
                  turnId: resolvedInput.turnId,
                  profileId: profile.id,
                },
              }),
              signal: resolvedInput.signal,
              configurable: {
                workflowInput: resolvedInput,
              },
              context: {
                workflowInput: resolvedInput,
              },
            },
          );

          const liveBudget = getTurnBudget();
          return {
            state: toRagWorkflowState(finalState),
            citations: getRagWorkflowCitations(finalState),
            answerText: finalState.answerText,
            profileId: profile.id,
            budgetSnapshot: {
              llmCalls: liveBudget?.llmCalls ?? budget.llmCalls,
              embedCalls: liveBudget?.embedCalls ?? budget.embedCalls,
              firstTokenLatencyMs:
                liveBudget?.firstTokenLatencyMs ?? budget.firstTokenLatencyMs,
              degradationFlags:
                liveBudget?.snapshotFlags() ?? budget.snapshotFlags(),
            },
          };
        },
      ),
    );
  }
}
