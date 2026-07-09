import { Inject, Injectable } from '@nestjs/common';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import type {
  KnowledgeAccessScope,
} from '@/knowledge/types/knowledge-content.types';
import type {
  RagCitation,
  RagOrchestrator,
  RagWorkflowResult,
} from '@/agent/types/rag-workflow.types';
import type { RagProfileId } from '@/common/rag/rag-profile';
import { throwIfAborted } from '@/common/utils';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';

export interface RunAgentParams {
  conversationId: string;
  personaId: string;
  userMessage: string;
  turnId: string;
  signal: AbortSignal;
  accessScope?: KnowledgeAccessScope;
  onToken: (token: string) => void;
  onCitations: (citations: RagCitation[]) => void;
  profileId?: RagProfileId;
  maxHops?: number;
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(RAG_ORCHESTRATOR)
    private readonly ragOrchestrator: RagOrchestrator,
  ) {}

  async run(params: RunAgentParams): Promise<RagWorkflowResult> {
    throwIfAborted(params.signal);

    return runInTracedScope(
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
          profileId: output.profileId ?? output.state.profileId,
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
      accessScope: params.accessScope,
      onToken: params.onToken,
      onCitations: params.onCitations,
      profileId: params.profileId,
      maxHops: params.maxHops,
    };
  }
}
