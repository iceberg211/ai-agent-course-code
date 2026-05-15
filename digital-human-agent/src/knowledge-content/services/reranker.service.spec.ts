import { createAbortError } from '@/agent/agent.utils';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

const mockInvoke = jest.fn();

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
  })),
}));

describe('RerankerService', () => {
  const chunk = {
    id: 'chunk-1',
    content: '测试片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.8,
  } satisfies KnowledgeChunk;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('调用 LLM 时会传递 AbortSignal', async () => {
    const service = new RerankerService();
    const abortController = new AbortController();
    mockInvoke.mockResolvedValue({
      content: '[{"index":0,"score":0.9}]',
    });

    const result = await service.rerank(
      '原始问题',
      [chunk],
      1,
      abortController.signal,
    );

    expect(result[0].rerank_score).toBe(0.9);
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        signal: abortController.signal,
      }),
    );
  });

  it('收到已中断信号时会抛出 AbortError，不会调用 LLM', async () => {
    const service = new RerankerService();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.rerank('原始问题', [chunk], 1, abortController.signal),
    ).rejects.toMatchObject(createAbortError());

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
