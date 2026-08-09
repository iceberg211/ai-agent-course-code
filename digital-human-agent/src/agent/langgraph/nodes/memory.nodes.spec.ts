import { createMergeMemoryContextNode } from '@/agent/langgraph/nodes/memory.nodes';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('memory.nodes', () => {
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
