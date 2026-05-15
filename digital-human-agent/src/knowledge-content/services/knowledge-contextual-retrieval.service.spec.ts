import { KnowledgeContextualRetrievalService } from '@/knowledge-content/services/knowledge-contextual-retrieval.service';

describe('KnowledgeContextualRetrievalService', () => {
  const chunks = [
    {
      pageContent: '试用期结束后，乙方应在七日内删除甲方试用数据。',
    },
  ];

  afterEach(() => {
    delete process.env.ENABLE_CONTEXTUAL_RETRIEVAL;
  });

  it('默认关闭时直接返回原始 chunk，避免 ingest 默认增加 LLM 调用', async () => {
    const llm = {
      invoke: jest.fn(),
    };
    const service = new KnowledgeContextualRetrievalService(llm as never);

    await expect(
      service.enrichChunks({
        filename: 'demo.md',
        documentContent: '# 服务协议\n\n试用期结束后删除数据。',
        chunks,
      }),
    ).resolves.toEqual(chunks);
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('开启后会为每个 chunk 加入文档级上下文前缀', async () => {
    process.env.ENABLE_CONTEXTUAL_RETRIEVAL = 'true';
    const llm = {
      invoke: jest.fn().mockResolvedValue({
        content: '本文档描述服务协议中的试用数据删除要求。',
      }),
    };
    const service = new KnowledgeContextualRetrievalService(llm as never);

    const result = await service.enrichChunks({
      filename: 'demo.md',
      documentContent: '# 服务协议\n\n试用期结束后删除数据。',
      chunks,
    });

    expect(result[0].pageContent).toBe(
      '[文档上下文] 本文档描述服务协议中的试用数据删除要求。\n试用期结束后，乙方应在七日内删除甲方试用数据。',
    );
    expect(llm.invoke).toHaveBeenCalledTimes(1);
  });
});
