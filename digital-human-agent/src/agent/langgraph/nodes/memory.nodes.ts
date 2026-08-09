import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import type { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import type { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import { assembleConversationContextParts } from '@/memory/utils/rolling-summary.utils';
import { withRemainingTurnTimeout } from '@/common/rag/turn-budget.context';

/** 生成前并行读取两类记忆，减少生成前串行 I/O。长期记忆在 LongTermMemoryService.search 内已做 policy 过滤。 */
export function createLoadGenerationMemoryNode(
  shortTermMemoryService: ShortTermMemoryService,
  memoryRetrieverService: MemoryRetrieverService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const shortTermPromise = withRemainingTurnTimeout(
      'rag_short_term_memory',
      () =>
        shortTermMemoryService.getContext(
          input.conversationId,
          input.accessScope?.ownerId,
        ),
      input.signal,
    ).catch(() => ({ window: [], summary: '', activeContext: '' }));
    const longTermPromise =
      state.useLongTermMemory === false
        ? Promise.resolve([])
        : withRemainingTurnTimeout(
            'rag_long_term_memory',
            () =>
              memoryRetrieverService.retrieve({
                query: state.question,
                ownerId: input.accessScope?.ownerId,
                department: input.accessScope?.department,
                accessScope: input.accessScope,
                limit: state.retrievalStrategy.memoryTopK ?? 5,
              }),
            input.signal,
          ).catch(() => []);
    const [shortTermMemory, longTermMemories] = await Promise.all([
      shortTermPromise,
      longTermPromise,
    ]);
    return {
      shortTermMemory,
      longTermMemories,
    } satisfies Partial<RagGraphState>;
  };
}

export function createMergeMemoryContextNode() {
  return (state: RagGraphState) => {
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
