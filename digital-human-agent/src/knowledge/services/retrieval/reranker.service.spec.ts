import { RerankerService } from '@/knowledge/services/retrieval/reranker.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

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

  function createService(options?: {
    invokeResult?: unknown;
    invokeError?: Error;
  }) {
    const defaultContent = JSON.stringify([
      { index: 1, score: 0.92 },
      { index: 0, score: 0.41 },
    ]);
    const model = {
      invoke: options?.invokeError
        ? jest.fn().mockRejectedValue(options.invokeError)
        : jest.fn().mockResolvedValue({
            content: options?.invokeResult !== undefined
              ? JSON.stringify(options.invokeResult)
              : defaultContent,
          }),
    };
    const llmFactory = {
      resolveModel: jest.fn().mockReturnValue(model),
      createChatModel: jest.fn().mockReturnValue(model),
    };

    const service = new RerankerService(llmFactory as never);

    return {
      service,
      model,
    };
  }

  it('LLM JSON 管道返回分数时按重排结果截断候选', async () => {
    const abortController = new AbortController();
    const { service, model } = createService();

    const result = await service.rerank(
      '原始问题',
      [chunk, chunk2],
      2,
      abortController.signal,
    );

    expect(model.invoke).toHaveBeenCalled();
    expect(result.map((item) => item.id)).toEqual(['chunk-2', 'chunk-1']);
    expect(result[0].rerank_score).toBe(0.92);
  });

  it('LLM 失败时回退到 Stage1 排序，不吞掉 AbortError', async () => {
    const { service } = createService({
      invokeError: new Error('json malformed'),
    });

    const result = await service.rerank('原始问题', [chunk, chunk2], 2);

    expect(result.map((item) => item.id)).toEqual(['chunk-1', 'chunk-2']);

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.rerank('原始问题', [chunk], 1, abortController.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
