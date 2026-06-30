import type { ConversationService } from '@/conversation/services/conversation.service';
import type { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import type { PersonaService } from '@/persona/persona.service';
import type { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

// ==========================================
// 辅助函数
// ==========================================
export function normalizePromptHistory(
  history: ConversationMessage[],
  currentTurnId: string,
): ConversationMessage[] {
  const filtered = history.filter(
    (message) => message.turnId !== currentTurnId,
  );

  let end = filtered.length;
  while (end > 0 && filtered[end - 1]?.role === 'user') {
    end -= 1;
  }

  return filtered.slice(0, end);
}

// ==========================================
// 1. load_context 节点
// ==========================================
export function createLoadContextNode(
  personaService: PersonaService,
  conversationService: ConversationService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const [persona, history] = await Promise.all([
      personaService.findOne(input.personaId),
      conversationService.getCompletedMessages(input.conversationId, 10),
    ]);

    return {
      persona,
      history: normalizePromptHistory(history, input.turnId),
    } satisfies Partial<RagGraphState>;
  };
}

// ==========================================
// 2. generate_answer 节点
// ==========================================
export function createGenerateAnswerNode(
  answerGenerationService: AnswerGenerationService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);

    if (state.strategy === 'none') {
      const answerText = await answerGenerationService.generateDirect({
        conversationId: input.conversationId,
        personaId: input.personaId,
        turnId: input.turnId,
        userMessage: input.question,
        signal: input.signal,
        onToken: input.onToken,
      });

      return {
        answerText,
      } satisfies Partial<RagGraphState>;
    }

    if (!state.persona) {
      throw new Error('回答生成前缺少 persona 上下文');
    }

    const answerText = await answerGenerationService.generate({
      conversationId: input.conversationId,
      personaId: input.personaId,
      turnId: input.turnId,
      userMessage: input.question,
      signal: input.signal,
      persona: state.persona,
      history: state.history,
      localChunks: state.topDocuments,
      memoryContext: state.memoryContext,
      retrievalStrategy: state.retrievalStrategy,
      webCitations: state.webCitations,
      evidenceAssessment:
        state.enough === null
          ? undefined
          : {
              enough: state.enough,
              missingFacts: state.missingFacts,
              evaluationReason: state.evaluationReason,
              stopReason: state.stopReason,
            },
      onToken: input.onToken,
    });

    return {
      answerText,
      } satisfies Partial<RagGraphState>;
  };
}
