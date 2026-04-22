import type { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

export function createGenerateAnswerNode(
  answerGenerationService: AnswerGenerationService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);

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
      localChunks: state.evidenceChunks,
      webCitations: state.webCitations,
      onToken: input.onToken,
    });

    return {
      answerText,
    } satisfies Partial<RagGraphState>;
  };
}
