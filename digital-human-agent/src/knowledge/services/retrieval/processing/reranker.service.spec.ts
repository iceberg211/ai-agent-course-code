import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
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
    const defaultResult = {
      scores: [
        { index: 1, score: 0.92 },
        { index: 0, score: 0.41 },
      ],
    };
    const invokeMock = options?.invokeError
      ? jest.fn().mockRejectedValue(options.invokeError)
      : jest.fn().mockResolvedValue(
          options?.invokeResult !== undefined
            ? options.invokeResult
            : defaultResult,
        );

    const model = {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke: invokeMock,
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
      invokeMock,
    };
  }

  it('LLM JSON 管道返回分数时按重排结果截断候选', async () => {
    const abortController = new AbortController();
    const { service, model, invokeMock } = createService();

    const result = await service.rerank(
      '原始问题',
      [chunk, chunk2],
      2,
      abortController.signal,
    );

    expect(model.withStructuredOutput).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalled();
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

  it('候选超过上限时保留 Stage1 当前顺序，不按 similarity 重新洗牌', async () => {
    const keywordFirst = {
      ...chunk,
      id: 'chunk-keyword-first',
      similarity: 0,
      keyword_score: 15,
      retrieval_sources: ['keyword' as const],
    } satisfies KnowledgeChunk;
    const vectorCandidates = Array.from({ length: 12 }, (_, index) => ({
      ...chunk,
      id: `chunk-vector-${index + 1}`,
      similarity: 0.99 - index * 0.01,
      retrieval_sources: ['vector' as const],
    })) satisfies KnowledgeChunk[];
    const { service } = createService({
      invokeResult: {
        scores: [{ index: 0, score: 0.95 }],
      },
    });

    const result = await service.rerank(
      '原始问题',
      [keywordFirst, ...vectorCandidates],
      1,
    );

    expect(result.map((item) => item.id)).toEqual(['chunk-keyword-first']);
  });

  it('LLM 返回空分数或全部低于阈值时，会回退到 Stage1 当前顺序', async () => {
    const { service: emptyScoreService } = createService({
      invokeResult: {
        scores: [],
      },
    });

    const emptyScoreResult = await emptyScoreService.rerank(
      '原始问题',
      [chunk, chunk2],
      2,
    );

    expect(emptyScoreResult.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
    ]);

    const { service: lowScoreService } = createService({
      invokeResult: {
        scores: [
          { index: 1, score: 0.1 },
          { index: 0, score: 0.05 },
        ],
      },
    });

    const lowScoreResult = await lowScoreService.rerank(
      '原始问题',
      [chunk, chunk2],
      2,
    );

    expect(lowScoreResult.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
    ]);
  });
});
