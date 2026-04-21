import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_RAG_MAX_HOPS } from '@/agent/agent.constants';
import { throwIfAborted } from '@/agent/agent.utils';
import { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import { RagRouteService } from '@/agent/services/rag-route.service';
import { WebFallbackService } from '@/agent/services/web-fallback.service';
import type {
  RagCitation,
  RagKnowledgeCitation,
  RagOrchestrator,
  RagWorkflowInput,
  RagWorkflowResult,
  RagWorkflowState,
  RagWebCitation,
} from '@/agent/types/rag-workflow.types';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { ConversationService } from '@/conversation/conversation.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { PersonaService } from '@/persona/persona.service';

@Injectable()
export class DefaultRagOrchestratorService implements RagOrchestrator {
  private readonly logger = new Logger(DefaultRagOrchestratorService.name);

  constructor(
    private readonly knowledgeSearchService: KnowledgeSearchService,
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    private readonly answerGenerationService: AnswerGenerationService,
    private readonly ragRouteService: RagRouteService,
    private readonly multiHopPlannerService: MultiHopPlannerService,
    private readonly evidenceEvaluatorService: EvidenceEvaluatorService,
    private readonly webFallbackService: WebFallbackService,
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
      await this.runMultiHopRetrieval(input, state);
    } else {
      await this.runSingleHopRetrieval(input, state, input.question);
    }

    if (!state.enough) {
      await this.runWebFallback(input, state);
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
      localChunks: state.evidenceChunks,
      webCitations: state.webCitations,
      onToken: input.onToken,
    });

    return {
      state,
      citations: state.citations,
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
      currentQuery: '',
      currentHop: 0,
      maxHops: input.maxHops ?? DEFAULT_RAG_MAX_HOPS,
      evidenceChunks: [],
      localCitations: [],
      webCitations: [],
      citations: [],
      retrievalHistory: [],
      enough: null,
      missingFacts: [],
      evaluationReason: '',
      webQuery: '',
      webSearchAttempted: false,
      webSearchUsed: false,
      stopReason: '',
      orchestrator: 'default',
    };
  }

  private async runSingleHopRetrieval(
    input: RagWorkflowInput,
    state: RagWorkflowState,
    query: string,
  ): Promise<void> {
    throwIfAborted(input.signal);
    const chunks = await this.knowledgeSearchService.retrieveForPersona(
      input.personaId,
      query,
    );

    state.currentQuery = query;
    state.currentHop = query.trim() ? 1 : 0;
    state.evidenceChunks = this.mergeEvidenceChunks([], chunks);
    state.retrievalHistory.push({
      query,
      resultCount: chunks.length,
    });
    this.refreshLocalCitations(state);
    this.publishCitations(input, state);
    await this.evaluateCurrentEvidence(input, state, 0);
    if (state.enough) {
      state.stopReason = 'single_hop_enough';
    } else {
      state.stopReason = 'single_hop_insufficient';
    }
  }

  private async runMultiHopRetrieval(
    input: RagWorkflowInput,
    state: RagWorkflowState,
  ): Promise<void> {
    const plannedQuestions =
      state.subQuestions.length > 0 ? state.subQuestions : [input.question];

    for (let index = 0; index < plannedQuestions.length; index += 1) {
      if (state.currentHop >= state.maxHops) {
        state.stopReason = 'max_hops_reached';
        break;
      }

      throwIfAborted(input.signal);
      const currentQuery = plannedQuestions[index]?.trim();
      if (!currentQuery) continue;

      const chunks = await this.knowledgeSearchService.retrieveForPersona(
        input.personaId,
        currentQuery,
      );

      state.currentQuery = currentQuery;
      state.currentHop += 1;
      state.retrievalHistory.push({
        query: currentQuery,
        resultCount: chunks.length,
      });
      state.evidenceChunks = this.mergeEvidenceChunks(state.evidenceChunks, chunks);
      this.refreshLocalCitations(state);
      this.publishCitations(input, state);

      const remaining = Math.max(plannedQuestions.length - index - 1, 0);
      await this.evaluateCurrentEvidence(input, state, remaining);
      if (state.enough) {
        state.stopReason = 'multi_hop_enough';
        break;
      }

      if (remaining === 0) {
        state.stopReason = 'sub_questions_exhausted';
      }
    }
  }

  private async runWebFallback(
    input: RagWorkflowInput,
    state: RagWorkflowState,
  ): Promise<void> {
    if (!this.webFallbackService.isEnabled()) {
      state.stopReason = 'web_fallback_disabled';
      return;
    }

    throwIfAborted(input.signal);
    const webQuery = state.webQuery.trim() || input.question;
    let webCitations: RagWebCitation[] = [];
    state.webSearchAttempted = true;

    try {
      webCitations = await this.webFallbackService.search({
        query: webQuery,
        signal: input.signal,
      });
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        throw error;
      }
      this.logger.warn(
        `联网补充失败，回退为本地证据回答：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      state.stopReason = 'web_fallback_failed';
      return;
    }

    if (webCitations.length === 0) {
      state.stopReason = 'web_fallback_empty';
      return;
    }

    state.webQuery = webQuery;
    state.webCitations = webCitations;
    state.webSearchUsed = true;
    this.publishCitations(input, state);

    await this.evaluateCurrentEvidence(input, state, 0);
    state.stopReason = state.enough
      ? 'web_fallback_enough'
      : 'web_fallback_insufficient';
  }

  private async evaluateCurrentEvidence(
    input: RagWorkflowInput,
    state: RagWorkflowState,
    remainingSubQuestionCount: number,
  ): Promise<void> {
    throwIfAborted(input.signal);
    const evaluation = await this.evidenceEvaluatorService.evaluate({
      question: input.question,
      localChunks: state.evidenceChunks,
      webCitations: state.webCitations,
      currentHop: state.currentHop,
      maxHops: state.maxHops,
      remainingSubQuestionCount,
      signal: input.signal,
    });

    state.enough = evaluation.enough;
    state.missingFacts = evaluation.missingFacts;
    state.evaluationReason = evaluation.reason;
    state.webQuery = evaluation.webQuery;
  }

  private mergeEvidenceChunks(
    existing: RetrievedKnowledgeChunk[],
    incoming: RetrievedKnowledgeChunk[],
  ): RetrievedKnowledgeChunk[] {
    const merged = new Map<string, RetrievedKnowledgeChunk>();

    for (const chunk of [...existing, ...incoming]) {
      const previous = merged.get(chunk.id);
      if (!previous) {
        merged.set(chunk.id, chunk);
        continue;
      }

      merged.set(chunk.id, {
        ...previous,
        similarity: Math.max(previous.similarity ?? 0, chunk.similarity ?? 0),
        hybrid_score: Math.max(
          previous.hybrid_score ?? 0,
          chunk.hybrid_score ?? 0,
        ),
        keyword_score: Math.max(
          previous.keyword_score ?? 0,
          chunk.keyword_score ?? 0,
        ),
        rerank_score: Math.max(
          previous.rerank_score ?? 0,
          chunk.rerank_score ?? 0,
        ),
        retrieval_sources: Array.from(
          new Set([
            ...(previous.retrieval_sources ?? []),
            ...(chunk.retrieval_sources ?? []),
          ]),
        ),
      });
    }

    return Array.from(merged.values()).sort((left, right) =>
      this.compareEvidence(right, left),
    );
  }

  private compareEvidence(
    left: RetrievedKnowledgeChunk,
    right: RetrievedKnowledgeChunk,
  ): number {
    return (
      (left.rerank_score ?? 0) - (right.rerank_score ?? 0) ||
      (left.hybrid_score ?? 0) - (right.hybrid_score ?? 0) ||
      (left.keyword_score ?? 0) - (right.keyword_score ?? 0) ||
      (left.similarity ?? 0) - (right.similarity ?? 0)
    );
  }

  private refreshLocalCitations(state: RagWorkflowState): void {
    state.localCitations = state.evidenceChunks.map((chunk) => ({
      kind: 'knowledge',
      ...chunk,
    }));
  }

  private publishCitations(
    input: RagWorkflowInput,
    state: RagWorkflowState,
  ): void {
    state.citations = [
      ...state.localCitations,
      ...state.webCitations,
    ] satisfies RagCitation[];

    if (state.citations.length > 0) {
      input.onCitations(state.citations);
    }
  }
}
