import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';

describe('KnowledgeSearchService', () => {
  const stage1Chunk = {
    id: 'chunk-1',
    content: '雁门关事件相关片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.92,
  };
  const stage1Chunk2 = {
    id: 'chunk-2',
    content: '萧峰结局相关片段',
    source: 'test.md',
    chunk_index: 1,
    category: null,
    similarity: 0.83,
  };

  function createService() {
    const runtime = {
      normalizeRetrieveOptions: jest.fn(() => ({
        threshold: 0.6,
        rerank: true,
        stage1TopK: 10,
        finalTopK: 5,
      })),
      withTransientRetry: jest.fn(
        async (_operation, fn: () => Promise<unknown>) => fn(),
      ),
      embeddings: {
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      },
      supabase: {
        from: jest.fn(),
      },
    };

    const hybridRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        chunks: [stage1Chunk, stage1Chunk2],
        keywordBackend: 'pg',
        vectorResultCount: 2,
        keywordResultCount: 1,
        fallbackToPg: false,
      }),
    };

    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([stage1Chunk, stage1Chunk2]),
    };

    const queryRewriteService = {
      rewrite: jest.fn().mockResolvedValue({
        originalQuery: '原始问题',
        rewrittenQuery: '改写后的检索问题',
        keywords: ['原始问题'],
        changed: true,
        reason: '补全实体，便于检索',
      }),
    };

    const service = new KnowledgeSearchService(
      runtime as never,
      hybridRetriever as never,
      rerankerService as never,
      queryRewriteService as never,
    );

    return {
      service,
      runtime,
      hybridRetriever,
      rerankerService,
      queryRewriteService,
    };
  }

  it('retrieveWithStages 会使用改写后的 query 做召回，但 rerank 仍基于原始问题', async () => {
    const {
      service,
      runtime,
      hybridRetriever,
      rerankerService,
      queryRewriteService,
    } = createService();

    const result = await service.retrieveWithStages('kb-1', '原始问题');

    expect(queryRewriteService.rewrite).toHaveBeenCalledWith('原始问题');
    expect(runtime.embeddings.embedQuery).toHaveBeenCalledWith(
      '改写后的检索问题',
    );
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalQuery: '改写后的检索问题',
        keywordTerms: ['原始问题'],
      }),
    );
    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '原始问题',
      [stage1Chunk, stage1Chunk2],
      5,
    );
    expect(result.query).toBe('原始问题');
    expect(result.retrievalQuery).toBe('改写后的检索问题');
    expect(result.rewrite.changed).toBe(true);
  });

  it('不启用 rerank 时仍会先做 Query Rewrite 再执行混合检索', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();

    runtime.normalizeRetrieveOptions.mockReturnValue({
      threshold: 0.6,
      rerank: false,
      stage1TopK: 10,
      finalTopK: 5,
    });

    const result = await service.retrieveWithStages('kb-1', '原始问题', {
      rerank: false,
    });

    expect(queryRewriteService.rewrite).toHaveBeenCalledWith('原始问题');
    expect(runtime.embeddings.embedQuery).toHaveBeenCalledWith(
      '改写后的检索问题',
    );
    expect(hybridRetriever.retrieve).toHaveBeenCalled();
    expect(result.retrievalQuery).toBe('改写后的检索问题');
  });
});
