import { Command } from '@langchain/langgraph';
import type { ConversationService } from '@/conversation/services/conversation.service';
import type { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import type { PersonaService } from '@/persona/persona.service';
import type { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import { withRemainingTurnTimeout } from '@/common/rag/turn-budget.context';

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

/** 检索前只读取最近两轮，供追问补全使用。 */
export function createLoadQueryHistoryNode(
  conversationService: ConversationService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    try {
      const history = await withRemainingTurnTimeout(
        'rag_query_history',
        () => conversationService.getCompletedMessages(input.conversationId, 4),
        input.signal,
      );
      return {
        queryHistory: normalizePromptHistory(history, input.turnId),
      } satisfies Partial<RagGraphState>;
    } catch {
      return { queryHistory: [] } satisfies Partial<RagGraphState>;
    }
  };
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
    // orchestrator 已预加载 history 时避免重复查库；仅补 persona
    const hasHistory = (state.history?.length ?? 0) > 0;
    const [persona, history] = await withRemainingTurnTimeout(
      'rag_generation_context',
      () =>
        Promise.all([
          personaService.findOne(input.personaId),
          hasHistory
            ? Promise.resolve(state.history)
            : conversationService.getCompletedMessages(
                input.conversationId,
                10,
              ),
        ]),
      input.signal,
    );

    const update = {
      persona,
      history: hasHistory
        ? state.history
        : normalizePromptHistory(history, input.turnId),
    } satisfies Partial<RagGraphState>;

    // 闲聊路径：加载人设后直接生成，跳过记忆读取。
    if (state.strategy === 'none') {
      return new Command({
        update,
        goto: 'generate_answer',
      });
    }

    return new Command({
      update,
      goto: 'load_generation_memory',
    });
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
      if (!state.persona) {
        throw new Error('闲聊生成前缺少 persona 上下文');
      }
      const answerText = await answerGenerationService.generateDirect({
        conversationId: input.conversationId,
        personaId: input.personaId,
        turnId: input.turnId,
        userMessage: input.question,
        signal: input.signal,
        onToken: input.onToken,
        persona: state.persona,
        history: state.history,
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
      // 检索节点累计候选，重排节点按原始问题统一选择最终证据。
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
