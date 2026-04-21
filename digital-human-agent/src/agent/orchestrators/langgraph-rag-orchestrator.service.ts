import { Injectable, Logger } from '@nestjs/common';
import {
  Annotation,
  END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
} from '@langchain/langgraph';
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
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import { ConversationService } from '@/conversation/conversation.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { PersonaService } from '@/persona/persona.service';

type RetrievalHistoryItem = { query: string; resultCount: number };

const LangGraphRagStateAnnotation = Annotation.Root({
  conversationId: Annotation<string>(),
  personaId: Annotation<string>(),
  question: Annotation<string>(),
  turnId: Annotation<string>(),
  strategy: Annotation<'simple' | 'complex'>(),
  routeReason: Annotation<string>(),
  subQuestions: Annotation<string[]>(),
  currentQuery: Annotation<string>(),
  currentHop: Annotation<number>(),
  maxHops: Annotation<number>(),
  evidenceChunks: Annotation<RetrievedKnowledgeChunk[]>(),
  localCitations: Annotation<RagKnowledgeCitation[]>(),
  webCitations: Annotation<RagWebCitation[]>(),
  citations: Annotation<RagCitation[]>(),
  retrievalHistory: Annotation<RetrievalHistoryItem[]>(),
  enough: Annotation<boolean | null>(),
  missingFacts: Annotation<string[]>(),
  evaluationReason: Annotation<string>(),
  webQuery: Annotation<string>(),
  webSearchAttempted: Annotation<boolean>(),
  webSearchUsed: Annotation<boolean>(),
  stopReason: Annotation<string>(),
  orchestrator: Annotation<'langgraph'>(),
  answerText: Annotation<string>(),
});

type LangGraphRagState = typeof LangGraphRagStateAnnotation.State;

interface LangGraphRuntimeContext {
  workflowInput: RagWorkflowInput;
}

type RagGraphConfig = LangGraphRunnableConfig<LangGraphRuntimeContext>;

@Injectable()
export class LangGraphRagOrchestratorService implements RagOrchestrator {
  private readonly logger = new Logger(LangGraphRagOrchestratorService.name);

  private readonly graph = new StateGraph(LangGraphRagStateAnnotation)
    .addNode('route_question', this.routeQuestionNode.bind(this))
    .addNode('plan_sub_questions', this.planSubQuestionsNode.bind(this))
    .addNode('prepare_query', this.prepareQueryNode.bind(this))
    .addNode('retrieve_evidence', this.retrieveEvidenceNode.bind(this))
    .addNode('evaluate_evidence', this.evaluateEvidenceNode.bind(this))
    .addNode('web_fallback', this.webFallbackNode.bind(this))
    .addNode('generate_answer', this.generateAnswerNode.bind(this))
    .addEdge(START, 'route_question')
    .addConditionalEdges(
      'route_question',
      this.routeAfterQuestion.bind(this),
      {
        simple: 'prepare_query',
        complex: 'plan_sub_questions',
      },
    )
    .addEdge('plan_sub_questions', 'prepare_query')
    .addEdge('prepare_query', 'retrieve_evidence')
    .addEdge('retrieve_evidence', 'evaluate_evidence')
    .addConditionalEdges(
      'evaluate_evidence',
      this.routeAfterEvaluation.bind(this),
      {
        continue_multi_hop: 'prepare_query',
        web_fallback: 'web_fallback',
        generate_answer: 'generate_answer',
      },
    )
    .addEdge('web_fallback', 'evaluate_evidence')
    .addEdge('generate_answer', END)
    .compile();

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
          this.buildInitialState(input),
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
          },
        );

        return {
          state: this.toWorkflowState(finalState),
          citations: finalState.citations,
          answerText: finalState.answerText,
        };
      },
    );
  }

  private buildInitialState(input: RagWorkflowInput): LangGraphRagState {
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
      orchestrator: 'langgraph',
      answerText: '',
    };
  }

  private toWorkflowState(state: LangGraphRagState): RagWorkflowState {
    const { answerText: _answerText, ...workflowState } = state;
    return workflowState;
  }

  private async routeQuestionNode(
    state: LangGraphRagState,
    config?: RagGraphConfig,
  ) {
    const input = this.getWorkflowInput(config);
    this.throwIfAborted(input);

    const route = await this.ragRouteService.routeQuestion(
      state.question,
      input.signal,
    );

    return {
      strategy: route.strategy,
      routeReason: route.reason,
    } satisfies Partial<LangGraphRagState>;
  }

  private routeAfterQuestion(state: LangGraphRagState): 'simple' | 'complex' {
    return state.strategy === 'complex' ? 'complex' : 'simple';
  }

  private async planSubQuestionsNode(
    state: LangGraphRagState,
    config?: RagGraphConfig,
  ) {
    const input = this.getWorkflowInput(config);
    this.throwIfAborted(input);

    const plan = await this.multiHopPlannerService.planSubQuestions(
      state.question,
      input.signal,
    );

    return {
      subQuestions:
        plan.subQuestions.length > 0 ? plan.subQuestions : [state.question],
    } satisfies Partial<LangGraphRagState>;
  }

  private prepareQueryNode(state: LangGraphRagState) {
    const plannedQuestions =
      state.strategy === 'complex' && state.subQuestions.length > 0
        ? state.subQuestions
        : [state.question];
    const nextQuery =
      plannedQuestions[state.currentHop]?.trim() || state.question.trim();

    return {
      currentQuery: nextQuery,
    } satisfies Partial<LangGraphRagState>;
  }

  private async retrieveEvidenceNode(
    state: LangGraphRagState,
    config?: RagGraphConfig,
  ) {
    const input = this.getWorkflowInput(config);
    this.throwIfAborted(input);

    const query = state.currentQuery.trim();
    if (!query) {
      return {};
    }

    const chunks = await this.knowledgeSearchService.retrieveForPersona(
      input.personaId,
      query,
    );

    const evidenceChunks = this.mergeEvidenceChunks(state.evidenceChunks, chunks);
    const localCitations = this.toKnowledgeCitations(evidenceChunks);
    const citations = this.mergeCitations(localCitations, state.webCitations);
    this.publishCitations(input, citations);

    return {
      currentHop: state.currentHop + 1,
      evidenceChunks,
      localCitations,
      citations,
      retrievalHistory: [
        ...state.retrievalHistory,
        {
          query,
          resultCount: chunks.length,
        },
      ],
    } satisfies Partial<LangGraphRagState>;
  }

  private async evaluateEvidenceNode(
    state: LangGraphRagState,
    config?: RagGraphConfig,
  ) {
    const input = this.getWorkflowInput(config);
    this.throwIfAborted(input);

    const evaluation = await this.evidenceEvaluatorService.evaluate({
      question: state.question,
      localChunks: state.evidenceChunks,
      webCitations: state.webCitations,
      currentHop: state.currentHop,
      maxHops: state.maxHops,
      remainingSubQuestionCount: this.getRemainingSubQuestionCount(state),
      signal: input.signal,
    });

    return {
      enough: evaluation.enough,
      missingFacts: evaluation.missingFacts,
      evaluationReason: evaluation.reason,
      webQuery: evaluation.webQuery,
      stopReason: this.resolveStopReason(state, evaluation.enough),
    } satisfies Partial<LangGraphRagState>;
  }

  private routeAfterEvaluation(
    state: LangGraphRagState,
  ):
    | 'continue_multi_hop'
    | 'web_fallback'
    | 'generate_answer' {
    if (state.enough) {
      return 'generate_answer';
    }

    if (this.canContinueMultiHop(state)) {
      return 'continue_multi_hop';
    }

    if (this.shouldUseWebFallback(state)) {
      return 'web_fallback';
    }

    return 'generate_answer';
  }

  private async webFallbackNode(
    state: LangGraphRagState,
    config?: RagGraphConfig,
  ) {
    const input = this.getWorkflowInput(config);
    if (!this.webFallbackService.isEnabled()) {
      return {
        stopReason: 'web_fallback_disabled',
      } satisfies Partial<LangGraphRagState>;
    }

    this.throwIfAborted(input);
    const webQuery = state.webQuery.trim() || state.question;

    try {
      const webCitations = await this.webFallbackService.search({
        query: webQuery,
        signal: input.signal,
      });

      if (webCitations.length === 0) {
        return {
          webQuery,
          webSearchAttempted: true,
          stopReason: 'web_fallback_empty',
        } satisfies Partial<LangGraphRagState>;
      }

      const citations = this.mergeCitations(state.localCitations, webCitations);
      this.publishCitations(input, citations);

      return {
        webQuery,
        webSearchAttempted: true,
        webCitations,
        webSearchUsed: true,
        citations,
      } satisfies Partial<LangGraphRagState>;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        throw error;
      }

      this.logger.warn(
        `联网补充失败，回退为本地证据回答：${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        webQuery,
        webSearchAttempted: true,
        stopReason: 'web_fallback_failed',
      } satisfies Partial<LangGraphRagState>;
    }
  }

  private async generateAnswerNode(
    state: LangGraphRagState,
    config?: RagGraphConfig,
  ) {
    const input = this.getWorkflowInput(config);
    this.throwIfAborted(input);

    const [persona, history] = await Promise.all([
      this.personaService.findOne(input.personaId),
      this.conversationService.getCompletedMessages(input.conversationId, 10),
    ]);

    this.throwIfAborted(input);
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
      answerText,
    } satisfies Partial<LangGraphRagState>;
  }

  private getWorkflowInput(config?: RagGraphConfig): RagWorkflowInput {
    const input = config?.configurable?.workflowInput;
    if (!input) {
      throw new Error('LangGraph 运行缺少 workflowInput');
    }
    return input;
  }

  private throwIfAborted(input: Pick<RagWorkflowInput, 'signal'>): void {
    throwIfAborted(input.signal);
  }

  private getRemainingSubQuestionCount(state: LangGraphRagState): number {
    if (state.strategy !== 'complex') {
      return 0;
    }
    return Math.max(state.subQuestions.length - state.currentHop, 0);
  }

  private canContinueMultiHop(state: LangGraphRagState): boolean {
    if (state.strategy !== 'complex') {
      return false;
    }

    return (
      state.currentHop < state.maxHops &&
      state.currentHop < state.subQuestions.length
    );
  }

  private shouldUseWebFallback(state: LangGraphRagState): boolean {
    return (
      !state.webSearchAttempted &&
      !state.webSearchUsed &&
      this.webFallbackService.isEnabled()
    );
  }

  private resolveStopReason(
    state: LangGraphRagState,
    enough: boolean,
  ): string {
    if (
      !enough &&
      state.webSearchAttempted &&
      !state.webSearchUsed &&
      (state.stopReason === 'web_fallback_failed' ||
        state.stopReason === 'web_fallback_empty' ||
        state.stopReason === 'web_fallback_disabled')
    ) {
      return state.stopReason;
    }

    if (enough) {
      if (state.webSearchUsed) {
        return 'web_fallback_enough';
      }
      if (state.strategy === 'complex' && state.currentHop > 1) {
        return 'multi_hop_enough';
      }
      return 'single_hop_enough';
    }

    if (state.webSearchUsed) {
      return 'web_fallback_insufficient';
    }

    if (state.strategy === 'complex') {
      if (state.currentHop >= state.maxHops) {
        return 'max_hops_reached';
      }
      if (state.currentHop >= state.subQuestions.length) {
        return 'sub_questions_exhausted';
      }
      return 'multi_hop_insufficient';
    }

    return 'single_hop_insufficient';
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

  private toKnowledgeCitations(
    chunks: RetrievedKnowledgeChunk[],
  ): RagKnowledgeCitation[] {
    return chunks.map((chunk) => ({
      kind: 'knowledge',
      ...chunk,
    }));
  }

  private mergeCitations(
    localCitations: RagKnowledgeCitation[],
    webCitations: RagWebCitation[],
  ): RagCitation[] {
    return [...localCitations, ...webCitations];
  }

  private publishCitations(
    input: RagWorkflowInput,
    citations: RagCitation[],
  ): void {
    if (citations.length > 0) {
      input.onCitations(citations);
    }
  }
}
