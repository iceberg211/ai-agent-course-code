import { Injectable } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import { type RagGraph, buildRagGraph } from '@/agent/langgraph/rag.graph';
import {
  buildInitialRagGraphState,
  getRagWorkflowCitations,
  toRagWorkflowState,
} from '@/agent/langgraph/rag.state';
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
import { ConversationService } from '@/conversation/conversation.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { PersonaService } from '@/persona/persona.service';

@Injectable()
export class LangGraphRagOrchestratorService implements RagOrchestrator {
  private readonly graph: RagGraph;

  constructor(
    private readonly knowledgeSearchService: KnowledgeSearchService,
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    private readonly answerGenerationService: AnswerGenerationService,
    private readonly ragRouteService: RagRouteService,
    private readonly multiHopPlannerService: MultiHopPlannerService,
    private readonly evidenceEvaluatorService: EvidenceEvaluatorService,
    private readonly webFallbackService: WebFallbackService,
  ) {
    this.graph = buildRagGraph({
      knowledgeSearchService: this.knowledgeSearchService,
      personaService: this.personaService,
      conversationService: this.conversationService,
      answerGenerationService: this.answerGenerationService,
      ragRouteService: this.ragRouteService,
      multiHopPlannerService: this.multiHopPlannerService,
      evidenceEvaluatorService: this.evidenceEvaluatorService,
      webFallbackService: this.webFallbackService,
    });
  }

  async run(input: RagWorkflowInput): Promise<RagWorkflowResult> {
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
          subQuestionCount: output.state.subQuestions.length,
          subQuestions: output.state.subQuestions,
          citationCount: output.citations.length,
          webCitationCount: output.state.webCitations.length,
          webSearchUsed: output.state.webSearchUsed,
          stopReason: output.state.stopReason,
          orchestrator: output.state.orchestrator,
        }),
      },
      async () => {
        throwIfAborted(input.signal);

        const finalState = await this.graph.invoke(
          buildInitialRagGraphState(input),
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
