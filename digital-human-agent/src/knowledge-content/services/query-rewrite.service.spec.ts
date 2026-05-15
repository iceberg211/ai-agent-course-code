import { createAbortError } from '@/agent/agent.utils';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';

const mockInvoke = jest.fn();
const mockWithStructuredOutput = jest.fn(() => ({
  invoke: mockInvoke,
}));

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: mockWithStructuredOutput,
  })),
}));

describe('QueryRewriteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('调用 LLM 时会传递 AbortSignal', async () => {
    const service = new QueryRewriteService();
    const abortController = new AbortController();
    mockInvoke.mockResolvedValue({
      rewrittenQuery: '改写后的问题',
      keywords: ['问题'],
      reason: '补全检索语义',
    });

    const result = await service.rewrite('原始问题', abortController.signal);

    expect(result.rewrittenQuery).toBe('改写后的问题');
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        signal: abortController.signal,
      }),
    );
  });

  it('收到已中断信号时会抛出 AbortError，不会调用 LLM', async () => {
    const service = new QueryRewriteService();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.rewrite('原始问题', abortController.signal),
    ).rejects.toMatchObject(createAbortError());

    expect(mockWithStructuredOutput).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
