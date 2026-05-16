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

  it('LLM 改写失败时会从中文长问题中提取本地关键词', async () => {
    const service = new QueryRewriteService();
    mockInvoke.mockRejectedValue(new Error('模型不可用'));

    const result = await service.rewrite(
      '示例服务协议里协议终止后的试用数据应如何处理？',
    );

    expect(result.changed).toBe(false);
    expect(result.keywords).toEqual(
      expect.arrayContaining(['服务协议', '协议终止', '试用数据']),
    );
    expect(result.expandedQueries[0].keywords).toEqual(
      expect.arrayContaining(['协议终止', '试用数据']),
    );
  });

  it('LLM 只返回 1 条扩展 query 时会补齐为 3 条检索 query', async () => {
    const service = new QueryRewriteService();
    mockInvoke.mockResolvedValue({
      rewrittenQuery: '示例服务协议中协议终止后的试用数据处理方式',
      keywords: ['示例服务协议', '协议终止', '试用数据'],
      expandedQueries: [
        {
          query: '示例服务协议中协议终止后的试用数据处理方式',
          keywords: ['示例服务协议', '协议终止', '试用数据'],
          angle: 'original',
        },
      ],
      reason: '原问题已经清晰',
    });

    const result = await service.rewrite(
      '示例服务协议里协议终止后的试用数据应如何处理？',
    );

    expect(result.expandedQueries).toHaveLength(3);
    expect(result.expandedQueries.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(result.expandedQueries.map((item) => item.angle)).toEqual([
      'original',
      'entity',
      'semantic',
    ]);
    expect(result.expandedQueries[1].query).toContain('协议终止');
    expect(result.expandedQueries[2].query).toContain('试用数据');
  });

  it('能兼容 qwen-max 将关键词返回为字符串的情况', async () => {
    const service = new QueryRewriteService();
    mockInvoke.mockResolvedValue({
      rewrittenQuery: '系统定位和智能检索的关系',
      keywords: '系统定位, 智能检索, 关系',
      expandedQueries: [
        {
          query: '系统定位和智能检索的包含子主题关系',
          keywords: '系统定位 智能检索 包含子主题',
          angle: 'entity',
        },
      ],
      reason: '补充实体关系表达',
    });

    const result = await service.rewrite(
      '系统定位和智能检索是什么关系？',
    );

    expect(result.keywords).toEqual(
      expect.arrayContaining(['系统定位', '智能检索', '关系']),
    );
    expect(result.expandedQueries[1].keywords).toEqual(
      expect.arrayContaining(['系统定位', '智能检索', '包含子主题']),
    );
  });
});
