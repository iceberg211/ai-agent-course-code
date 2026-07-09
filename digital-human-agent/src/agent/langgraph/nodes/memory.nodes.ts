import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import type { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import type { MemoryPolicyService } from '@/memory/services/memory-policy.service';

export function createLoadShortTermMemoryNode(
  shortTermMemoryService: ShortTermMemoryService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    try {
      const shortTermMemory = await shortTermMemoryService.getContext(
        input.conversationId,
        input.accessScope?.ownerId,
      );
      return { shortTermMemory } satisfies Partial<RagGraphState>;
    } catch {
      return {
        shortTermMemory: {
          window: [],
          summary: '',
          activeContext: '',
        },
      } satisfies Partial<RagGraphState>;
    }
  };
}

export function createRetrieveLongTermMemoryNode(
  memoryRetrieverService: MemoryRetrieverService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    try {
      const longTermMemories = await memoryRetrieverService.retrieve({
        query: state.question,
        ownerId: input.accessScope?.ownerId,
        department: input.accessScope?.department,
        accessScope: input.accessScope,
        limit: state.retrievalStrategy.memoryTopK ?? 5,
      });
      return { longTermMemories } satisfies Partial<RagGraphState>;
    } catch {
      return { longTermMemories: [] } satisfies Partial<RagGraphState>;
    }
  };
}

export function createFilterMemoryByPolicyNode(
  memoryPolicyService: MemoryPolicyService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    return {
      longTermMemories: memoryPolicyService.filterReadable(
        state.longTermMemories,
        input.accessScope,
      ),
    } satisfies Partial<RagGraphState>;
  };
}

export function createMergeMemoryContextNode() {
  return async (state: RagGraphState) => {
    // 知识库证据只在 generate_answer 的 knowledgeBlock 注入，避免双重拼装浪费 token

    // ── 短期记忆 ────────────────────────────────────────────────
    const shortWindow = state.shortTermMemory.window
      .slice(-8)
      .map((item) => `${item.role}: ${item.content}`)
      .join('\n');
    const shortParts = [
      state.shortTermMemory.summary
        ? `会话摘要：${state.shortTermMemory.summary}`
        : '',
      state.shortTermMemory.activeContext
        ? `当前任务背景：${state.shortTermMemory.activeContext}`
        : '',
      shortWindow ? `最近对话：\n${shortWindow}` : '',
    ].filter(Boolean);

    // ── 长期记忆 ────────────────────────────────────────────────
    const longParts = state.longTermMemories
      .slice(0, 8)
      .map(
        (item, index) =>
          `[记忆 ${index + 1}] 类型：${item.category}；可信度：${item.confidence.toFixed(
            2,
          )}\n${item.content}`,
      );

    // 仅合并会话记忆与用户偏好；企业知识由 knowledgeBlock 单独提供
    return {
      memoryContext: [
        '<conversation_context>',
        shortParts.join('\n\n') || '（当前会话暂无可用短期记忆）',
        '</conversation_context>',
        '',
        '<user_preference>',
        longParts.join('\n\n') || '（当前用户暂无可用长期记忆）',
        '</user_preference>',
      ].join('\n'),
    } satisfies Partial<RagGraphState>;
  };
}

