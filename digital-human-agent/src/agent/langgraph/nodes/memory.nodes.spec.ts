import {
  createMergeMemoryContextNode,
  createRetrieveLongTermMemoryNode,
} from '@/agent/langgraph/nodes/memory.nodes';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('memory.nodes', () => {
  const config = {
    configurable: {
      workflowInput: {
        conversationId: 'conv-1',
        personaId: 'persona-1',
        userMessage: '你好',
        turnId: 'turn-1',
        accessScope: { ownerId: 'owner-1', department: null, role: null },
        profileId: 'balanced_chat' as const,
      },
    },
  };

  it('useLongTermMemory=false 时不调用 retriever', async () => {
    const memoryRetrieverService = {
      retrieve: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          content: '偏好简洁',
          category: 'preference',
          confidence: 0.9,
        },
      ]),
    };
    const node = createRetrieveLongTermMemoryNode(
      memoryRetrieverService as never,
    );
    const result = await node(
      { useLongTermMemory: false, question: '你好' } as RagGraphState,
      config as never,
    );
    expect(result.longTermMemories).toEqual([]);
    expect(memoryRetrieverService.retrieve).not.toHaveBeenCalled();
  });

  it('useLongTermMemory=true 时加载长期记忆', async () => {
    const memories = [
      {
        id: 'm1',
        content: '偏好简洁',
        category: 'preference',
        confidence: 0.9,
      },
    ];
    const memoryRetrieverService = {
      retrieve: jest.fn().mockResolvedValue(memories),
    };
    const node = createRetrieveLongTermMemoryNode(
      memoryRetrieverService as never,
    );
    const result = await node(
      {
        useLongTermMemory: true,
        question: '你好',
        retrievalStrategy: { memoryTopK: 3 },
      } as RagGraphState,
      config as never,
    );
    expect(result.longTermMemories).toEqual(memories);
    expect(memoryRetrieverService.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '你好',
        ownerId: 'owner-1',
        limit: 3,
      }),
    );
  });

  it('merge 只使用摘要和任务背景，避免与 prompt history 重复', async () => {
    const node = createMergeMemoryContextNode();
    const result = await node({
      shortTermMemory: {
        summary: '讨论过验收',
        activeContext: '法务审阅',
        window: [
          { role: 'user', content: '旧消息A' },
          { role: 'assistant', content: '旧消息B' },
          { role: 'user', content: '中间问题' },
          { role: 'assistant', content: '中间回答' },
          { role: 'user', content: '新问题' },
          { role: 'assistant', content: '新回答' },
        ],
      },
      longTermMemories: [
        {
          id: 'm1',
          content: '喜欢要点列表',
          category: 'preference',
          confidence: 0.88,
        },
      ],
    } as RagGraphState);

    expect(result.memoryContext).toContain('<conversation_context>');
    expect(result.memoryContext).toContain('讨论过验收');
    expect(result.memoryContext).not.toContain('新问题');
    expect(result.memoryContext).not.toContain('用户：旧消息A');
    expect(result.memoryContext).not.toContain('助手：旧消息B');
    expect(result.memoryContext).toContain('<user_preference>');
    expect(result.memoryContext).toContain('喜欢要点列表');
  });
});
