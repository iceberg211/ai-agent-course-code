import { createAbortError } from '@/agent/agent.utils';
import { DashScopeQwenRerankerProvider } from '@/knowledge-content/rerankers/dashscope-qwen-reranker.provider';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

describe('DashScopeQwenRerankerProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const chunk = {
    id: 'chunk-1',
    content: '测试片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.8,
  } satisfies KnowledgeChunk;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('内部超时时抛出普通错误，允许上层 provider fallback 接管', async () => {
    process.env.OPENAI_API_KEY = 'dashscope-key';
    process.env.RERANKER_TIMEOUT_MS = '1';
    global.fetch = jest.fn((_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal;

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const provider = new DashScopeQwenRerankerProvider();

    await expect(
      provider.rerank({
        query: '原始问题',
        candidates: [chunk],
        topK: 1,
      }),
    ).rejects.toThrow('DashScope rerank 超时');
  });

  it('用户中断仍保留 AbortError 语义', async () => {
    process.env.OPENAI_API_KEY = 'dashscope-key';
    const provider = new DashScopeQwenRerankerProvider();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      provider.rerank({
        query: '原始问题',
        candidates: [chunk],
        topK: 1,
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject(createAbortError());
  });

  it('返回格式异常时抛出普通错误，允许上层继续降级', async () => {
    process.env.OPENAI_API_KEY = 'dashscope-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: {
          results: [
            {
              index: 'bad-index',
              relevance_score: Number.NaN,
            },
          ],
        },
      }),
    } as unknown as Response);

    const provider = new DashScopeQwenRerankerProvider();

    await expect(
      provider.rerank({
        query: '原始问题',
        candidates: [chunk],
        topK: 1,
      }),
    ).rejects.toThrow('DashScope rerank 返回结果为空或格式异常');
  });
});
