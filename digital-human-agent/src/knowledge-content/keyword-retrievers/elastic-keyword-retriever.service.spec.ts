import { ElasticKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/elastic-keyword-retriever.service';

describe('ElasticKeywordRetrieverService', () => {
  it('开启精确短语时会构造 match_phrase 和 source/category 精确加权查询', async () => {
    const search = jest.fn().mockResolvedValue({
      hits: {
        hits: [],
      },
    });
    const elasticsearchIndexService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue({ search }),
      ensureKnowledgeChunkIndex: jest.fn().mockResolvedValue(undefined),
      getKnowledgeChunkReadAlias: jest
        .fn()
        .mockReturnValue('digital-human-knowledge-chunk-read'),
    };
    const service = new ElasticKeywordRetrieverService(
      elasticsearchIndexService as never,
    );

    await service.retrieveChunks({
      knowledgeId: 'kb-1',
      terms: ['雁门关事件', 'mock-legal-service-agreement.md'],
      matchCount: 5,
      useExactPhrase: true,
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          bool: expect.objectContaining({
            should: expect.arrayContaining([
              expect.objectContaining({
                match_phrase: expect.objectContaining({
                  content: expect.objectContaining({
                    query: '雁门关事件',
                    boost: expect.any(Number),
                  }),
                }),
              }),
              expect.objectContaining({
                term: expect.objectContaining({
                  'source.keyword': expect.objectContaining({
                    value: 'mock-legal-service-agreement.md',
                    boost: expect.any(Number),
                  }),
                }),
              }),
              expect.objectContaining({
                term: expect.objectContaining({
                  'category.keyword': expect.objectContaining({
                    value: '雁门关事件',
                    boost: expect.any(Number),
                  }),
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });
});
