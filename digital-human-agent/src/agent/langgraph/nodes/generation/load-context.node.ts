import type { ConversationService } from '@/conversation/conversation.service';
import type { ConversationMessage } from '@/conversation/conversation-message.entity';
import type { PersonaService } from '@/persona/persona.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

function normalizePromptHistory(
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
