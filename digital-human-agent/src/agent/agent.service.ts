import { Inject, Injectable } from '@nestjs/common';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import type {
  RagOrchestrator,
  RagWorkflowResult,
} from '@/agent/rag-workflow.types';
import { throwIfAborted } from '@/agent/agent.utils';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export interface RunAgentParams {
  conversationId: string;
  personaId: string;
  userMessage: string;
  turnId: string;
  signal: AbortSignal;
  onToken: (token: string) => void;
  onCitations: (citations: RetrievedKnowledgeChunk[]) => void;
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(RAG_ORCHESTRATOR)
    private readonly ragOrchestrator: RagOrchestrator,
  ) {}

  async run(params: RunAgentParams): Promise<void> {
    throwIfAborted(params.signal);

    await runInTracedScope(
      {
        name: 'agent_turn',
        runType: 'chain',
        tags: ['agent', 'rag', 'chat'],
        metadata: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
        },
        input: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
          userMessage: params.userMessage,
        },
        outputProcessor: (output: RagWorkflowResult) => ({
          status: 'completed',
          strategy: output.state.strategy,
          routeReason: output.state.routeReason,
          subQuestionCount: output.state.subQuestions.length,
          orchestrator: output.state.orchestrator,
          citationCount: output.citations.length,
        }),
      },
      () => this.ragOrchestrator.run(this.toWorkflowInput(params)),
    );
  }

  private toWorkflowInput(params: RunAgentParams) {
    return {
      conversationId: params.conversationId,
      personaId: params.personaId,
      question: params.userMessage,
      turnId: params.turnId,
      signal: params.signal,
      onToken: params.onToken,
      onCitations: params.onCitations,
    };
  }
}
