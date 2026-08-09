import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { LlmRerankerProvider } from '@/knowledge/services/retrieval/processing/llm-reranker.provider';
import { NoopRerankerProvider } from '@/knowledge/services/retrieval/processing/noop-reranker.provider';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

describe('RerankerService & Providers', () => {
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
    providerType?: string;
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
      resolveModel: jest.fn().mockReturnValue('mock-model'),
      createChatModel: jest.fn().mockReturnValue(model),
    };

    const configService = {
      get: jest.fn().mockReturnValue(options?.providerType || 'llm'),
    };

    const llmProvider = new LlmRerankerProvider(llmFactory as any);
    const noopProvider = new NoopRerankerProvider();
    const scoreProvider = {
      rerank: jest.fn(async ({ candidates, topK = 5 }: any) =>
        candidates.slice(0, topK).map((c: any, i: number) => ({
          ...c,
          rerank_score: 1 - i * 0.1,
        })),
      ),
    };
    const dedicatedProvider = {
      isConfigured: jest.fn().mockReturnValue(false),
      rerank: scoreProvider.rerank,
    };

    const service = new RerankerService(
      configService as any,
      llmProvider,
      noopProvider,
      scoreProvider as any,
      dedicatedProvider as any,
    );

    return {
      service,
      model,
      invokeMock,
      scoreProvider,
      dedicatedProvider,
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

  it('Noop Reranker 模式下只返回前 topK 个元素', async () => {
    const { service } = createService({
      providerType: 'noop',
    });

    const result = await service.rerank('原始问题', [chunk, chunk2], 1);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('chunk-1');
    expect(result[0].rerank_score).toBe(1.0);
  });
});
