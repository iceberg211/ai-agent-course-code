import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
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
import { QueryAugmentationService } from '@/agent/services/query-augmentation.service';
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

@Injectable()
export class LangGraphRagOrchestratorService implements RagOrchestrator, OnModuleInit {
  private readonly logger = new Logger(LangGraphRagOrchestratorService.name);
  private graph: RagGraph;

  constructor(
    private readonly personaHybridRetrieverService: HybridRetrieverService,
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    private readonly answerGenerationService: AnswerGenerationService,
    private readonly ragRouteService: RagRouteService,
    private readonly queryAugmentationService: QueryAugmentationService,
    private readonly multiHopPlannerService: MultiHopPlannerService,
    private readonly rerankerService: RerankerService,
    private readonly evidenceEvaluatorService: EvidenceEvaluatorService,
    private readonly webFallbackService: WebFallbackService,
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
      queryAugmentationService: this.queryAugmentationService,
      multiHopPlannerService: this.multiHopPlannerService,
      rerankerService: this.rerankerService,
      evidenceEvaluatorService: this.evidenceEvaluatorService,
      webFallbackService: this.webFallbackService,
    });
  }

  async run(input: RagWorkflowInput): Promise<RagWorkflowResult> {
    if (!this.graph) {
      this.compileGraph();
    }
    return runInTracedScope(
      {
        name: 'langgraph_rag_orchestrator',
        runType: 'chain',
        tags: ['agent', 'rag', 'orchestrator', 'langgraph'],
        metadata: {
          conversationId: input.conversationId,
          personaId: input.personaId,
          turnId: input.turnId,
          orchestrator: 'langgraph',
        },
        input: {
          conversationId: input.conversationId,
          personaId: input.personaId,
          turnId: input.turnId,
          question: input.question,
          maxHops: input.maxHops,
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
          plannedNext: output.state.plannedNext,
          orchestrator: output.state.orchestrator,
        }),
      },
      async () => {
        throwIfAborted(input.signal);
        const initialHistory = normalizePromptHistory(
          await this.conversationService.getCompletedMessages(
            input.conversationId,
            10,
          ),
          input.turnId,
        );
        throwIfAborted(input.signal);

        const finalState = await this.graph.invoke(
          buildInitialRagGraphState(input, initialHistory),
          {
            ...buildLangSmithRunnableConfig({
              runName: 'langgraph_rag_workflow',
              tags: ['agent', 'rag', 'langgraph'],
              metadata: {
                conversationId: input.conversationId,
                personaId: input.personaId,
                turnId: input.turnId,
              },
            }),
            signal: input.signal,
            configurable: {
              workflowInput: input,
            },
            context: {
              workflowInput: input,
            },
          },
        );

        return {
          state: toRagWorkflowState(finalState),
          citations: getRagWorkflowCitations(finalState),
          answerText: finalState.answerText,
        };
      },
    );
  }
}
