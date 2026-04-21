import { Injectable } from '@nestjs/common';
import { DEFAULT_RAG_MAX_HOPS } from '@/agent/agent.constants';
import { throwIfAborted } from '@/agent/agent.utils';
import type {
  RagOrchestrator,
  RagWorkflowInput,
  RagWorkflowResult,
  RagWorkflowState,
} from '@/agent/rag-workflow.types';
import { AnswerGenerationService } from '@/agent/answer-generation.service';
import { MultiHopPlannerService } from '@/agent/multi-hop-planner.service';
import { RagRouteService } from '@/agent/rag-route.service';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { ConversationService } from '@/conversation/conversation.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { PersonaService } from '@/persona/persona.service';

@Injectable()
export class DefaultRagOrchestratorService implements RagOrchestrator {
  constructor(
    private readonly knowledgeSearchService: KnowledgeSearchService,
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    private readonly answerGenerationService: AnswerGenerationService,
    private readonly ragRouteService: RagRouteService,
    private readonly multiHopPlannerService: MultiHopPlannerService,
  ) {}

  async run(input: RagWorkflowInput): Promise<RagWorkflowResult> {
    return runInTracedScope(
      {
        name: 'default_rag_orchestrator',
        runType: 'chain',
        tags: ['agent', 'rag', 'orchestrator'],
        metadata: {
          conversationId: input.conversationId,
          personaId: input.personaId,
          turnId: input.turnId,
          orchestrator: 'default',
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
          subQuestionCount: output.state.subQuestions.length,
          citationCount: output.citations.length,
          orchestrator: output.state.orchestrator,
        }),
      },
      () => this.runInternal(input),
    );
  }

  private async runInternal(input: RagWorkflowInput): Promise<RagWorkflowResult> {
    const state = this.buildInitialState(input);
    throwIfAborted(input.signal);

    const route = await this.ragRouteService.routeQuestion(
      input.question,
      input.signal,
    );
    state.strategy = route.strategy;
    state.routeReason = route.reason;

    if (route.strategy === 'complex') {
      throwIfAborted(input.signal);
      const plan = await this.multiHopPlannerService.planSubQuestions(
        input.question,
        input.signal,
      );
      state.subQuestions = plan.subQuestions;
    }

    throwIfAborted(input.signal);
    const chunks: RetrievedKnowledgeChunk[] =
      await this.knowledgeSearchService.retrieveForPersona(
        input.personaId,
        input.question,
      );

    throwIfAborted(input.signal);
    state.currentHop = input.question.trim() ? 1 : 0;
    state.evidenceChunks = chunks;
    state.citations = chunks;

    if (chunks.length > 0) {
      input.onCitations(chunks);
    }

    throwIfAborted(input.signal);
    const [persona, history] = await Promise.all([
      this.personaService.findOne(input.personaId),
      this.conversationService.getCompletedMessages(input.conversationId, 10),
    ]);

    throwIfAborted(input.signal);
    const answerText = await this.answerGenerationService.generate({
      conversationId: input.conversationId,
      personaId: input.personaId,
      turnId: input.turnId,
      userMessage: input.question,
      signal: input.signal,
      persona,
      history,
      chunks,
      onToken: input.onToken,
    });

    return {
      state,
      citations: chunks,
      answerText,
    };
  }

  private buildInitialState(input: RagWorkflowInput): RagWorkflowState {
    return {
      conversationId: input.conversationId,
      personaId: input.personaId,
      question: input.question,
      turnId: input.turnId,
      strategy: 'simple',
      routeReason: '尚未执行路由',
      subQuestions: [],
      currentHop: 0,
      maxHops: input.maxHops ?? DEFAULT_RAG_MAX_HOPS,
      evidenceChunks: [],
      citations: [],
      orchestrator: 'default',
    };
  }
}
