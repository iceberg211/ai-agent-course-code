import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import type { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import type { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import { assembleConversationContextParts } from '@/memory/utils/rolling-summary.utils';

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

/** 生成前并行读取两类记忆，减少生成前串行 I/O。 */
export function createLoadGenerationMemoryNode(
  shortTermMemoryService: ShortTermMemoryService,
  memoryRetrieverService: MemoryRetrieverService,
  memoryPolicyService: MemoryPolicyService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const shortTermPromise = shortTermMemoryService
      .getContext(input.conversationId, input.accessScope?.ownerId)
      .catch(() => ({ window: [], summary: '', activeContext: '' }));
    const longTermPromise =
      state.useLongTermMemory === false
        ? Promise.resolve([])
        : memoryRetrieverService
            .retrieve({
              query: state.question,
              ownerId: input.accessScope?.ownerId,
              department: input.accessScope?.department,
              accessScope: input.accessScope,
              limit: state.retrievalStrategy.memoryTopK ?? 5,
            })
            .catch(() => []);
    const [shortTermMemory, longTermMemories] = await Promise.all([
      shortTermPromise,
      longTermPromise,
    ]);
    return {
      shortTermMemory,
      longTermMemories: memoryPolicyService.filterReadable(
        longTermMemories,
        input.accessScope,
      ),
    } satisfies Partial<RagGraphState>;
  };
}

export function createRetrieveLongTermMemoryNode(
  memoryRetrieverService: MemoryRetrieverService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    // 长期记忆只用于生成上下文，永不进入 rewrite/retrieve query；profile 可关闭加载
    if (state.useLongTermMemory === false) {
      return { longTermMemories: [] } satisfies Partial<RagGraphState>;
    }
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
    // DB history 已作为 prompt history 注入；此处仅保留摘要与任务背景，避免重复最近会话。
    const shortParts = assembleConversationContextParts({
      summary: state.shortTermMemory.summary ?? '',
      activeContext: state.shortTermMemory.activeContext ?? '',
      window: state.shortTermMemory.window ?? [],
      recentLimit: 0,
    });

    // 长期偏好：仅影响风格/习惯，不改写企业知识（由 system prompt 约束）
    const longParts = (state.longTermMemories ?? [])
      .slice(0, 5)
      .map(
        (item, index) =>
          `[记忆 ${index + 1}] 类型：${item.category}；可信度：${item.confidence.toFixed(
            2,
          )}\n${item.content.slice(0, 500)}`,
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
