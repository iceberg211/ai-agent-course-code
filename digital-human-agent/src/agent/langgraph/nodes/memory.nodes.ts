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
    // 对话轮次由 prompt history（DB）统一承载，此处不再重复注入 window，避免 token 三倍膨胀
    // 短期记忆只保留 summary + activeContext（跨轮任务背景）
    const shortParts = [
      state.shortTermMemory.summary
        ? `会话摘要：${state.shortTermMemory.summary}`
        : '',
      state.shortTermMemory.activeContext
        ? `当前任务背景：${state.shortTermMemory.activeContext}`
        : '',
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

    return {
      memoryContext: [
        '<conversation_context>',
        shortParts.join('\n\n') || '（当前会话暂无额外摘要/任务背景）',
        '</conversation_context>',
        '',
        '<user_preference>',
        longParts.join('\n\n') || '（当前用户暂无可用长期记忆）',
        '</user_preference>',
      ].join('\n'),
    } satisfies Partial<RagGraphState>;
  };
}
