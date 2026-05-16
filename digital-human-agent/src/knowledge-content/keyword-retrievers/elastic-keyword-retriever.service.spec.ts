import type { estypes } from '@elastic/elasticsearch';
import { ElasticKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/elastic-keyword-retriever.service';

describe('ElasticKeywordRetrieverService', () => {
  type SearchOptions = { signal?: AbortSignal };
  type EmptySearchResponse = { hits: { hits: [] } };

  function createService() {
    const search = jest
      .fn<
        Promise<EmptySearchResponse>,
        [estypes.SearchRequest, SearchOptions?]
      >()
      .mockResolvedValue({
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

    return { service, search };
  }

  it('开启精确短语时会构造 match_phrase 和 source/category 精确加权查询', async () => {
    const { service, search } = createService();

    await service.retrieveChunks({
      knowledgeId: 'kb-1',
      terms: ['雁门关事件', 'mock-legal-service-agreement.md'],
      matchCount: 5,
      useExactPhrase: true,
    });

    const requestJson = JSON.stringify(search.mock.calls[0]?.[0]);
    expect(requestJson).toContain('"match_phrase"');
    expect(requestJson).toContain('"query":"雁门关事件"');
    expect(requestJson).toContain('"source.keyword"');
    expect(requestJson).toContain('"value":"mock-legal-service-agreement.md"');
    expect(requestJson).toContain('"category.keyword"');
  });

  it('传入 AbortSignal 时会交给 Elasticsearch client', async () => {
    const signal = new AbortController().signal;
    const { service, search } = createService();

    await service.retrieveChunks({
      knowledgeId: 'kb-1',
      terms: ['删除时限'],
      matchCount: 5,
      signal,
    });

    expect(search.mock.calls[0]?.[1]).toEqual({ signal });
  });
});
