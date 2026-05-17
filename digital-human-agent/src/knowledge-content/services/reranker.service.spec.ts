import { RerankerService } from '@/knowledge-content/services/reranker.service';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

describe('RerankerService', () => {
  const chunk = {
    id: 'chunk-1',
    content: '测试片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.8,
  } satisfies KnowledgeChunk;
  const chunk2 = {
    ...chunk,
    id: 'chunk-2',
    content: '另一个测试片段',
    similarity: 0.4,
  } satisfies KnowledgeChunk;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('LLM JSON provider 返回分数时按重排结果截断候选', async () => {
    const abortController = new AbortController();
    const llmProvider = {
      name: 'llm-json',
      model: 'qwen-plus',
      rerank: jest.fn().mockResolvedValue([
        { index: 1, score: 0.92 },
        { index: 0, score: 0.41 },
      ]),
    };
    const service = new RerankerService(llmProvider as never);

    const result = await service.rerank(
      '原始问题',
      [chunk, chunk2],
      2,
      abortController.signal,
    );

    expect(llmProvider.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '原始问题',
        candidates: [chunk, chunk2],
        topK: 2,
        signal: abortController.signal,
      }),
    );
    expect(result.map((item) => item.id)).toEqual(['chunk-2', 'chunk-1']);
    expect(result[0].rerank_score).toBe(0.92);
  });

  it('provider 失败时回退到 Stage1 排序，不吞掉 AbortError', async () => {
    const llmProvider = {
      name: 'llm-json',
      model: 'qwen-plus',
      rerank: jest.fn().mockRejectedValue(new Error('json malformed')),
    };
    const service = new RerankerService(llmProvider as never);

    const result = await service.rerank('原始问题', [chunk, chunk2], 2);

    expect(result.map((item) => item.id)).toEqual(['chunk-1', 'chunk-2']);

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.rerank('原始问题', [chunk], 1, abortController.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
