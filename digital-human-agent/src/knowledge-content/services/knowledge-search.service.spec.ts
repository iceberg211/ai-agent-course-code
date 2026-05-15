import { createAbortError } from '@/agent/agent.utils';
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
        hydeVectorResultCount: 0,
        keywordResultCount: 1,
        fallbackToPg: false,
        skippedChannels: [],
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
        expandedQueries: [
          {
            index: 0,
            query: '改写后的检索问题',
            keywords: ['原始问题'],
            angle: 'original',
          },
        ],
        changed: true,
        reason: '补全实体，便于检索',
      }),
      generateHypotheticalAnswer: jest.fn().mockResolvedValue('假设答案文本'),
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

    expect(queryRewriteService.rewrite).toHaveBeenCalledWith(
      '原始问题',
      undefined,
    );
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
      [
        expect.objectContaining({ id: 'chunk-1' }),
        expect.objectContaining({ id: 'chunk-2' }),
      ],
      5,
      undefined,
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

    expect(queryRewriteService.rewrite).toHaveBeenCalledWith(
      '原始问题',
      undefined,
    );
    expect(runtime.embeddings.embedQuery).toHaveBeenCalledWith(
      '改写后的检索问题',
    );
    expect(hybridRetriever.retrieve).toHaveBeenCalled();
    expect(result.retrievalQuery).toBe('改写后的检索问题');
  });

  it('multi-query 会逐条召回并按 chunk.id 合并去重，rerank 仍使用原始问题', async () => {
    const {
      service,
      runtime,
      hybridRetriever,
      rerankerService,
      queryRewriteService,
    } = createService();
    queryRewriteService.rewrite.mockResolvedValue({
      originalQuery: '原始问题',
      rewrittenQuery: '改写后的检索问题',
      keywords: ['原始问题'],
      expandedQueries: [
        {
          index: 0,
          query: '改写后的检索问题',
          keywords: ['原始问题'],
          angle: 'original',
        },
        {
          index: 1,
          query: '实体角度问题',
          keywords: ['实体角度'],
          angle: 'entity',
        },
      ],
      changed: true,
      reason: '生成多角度检索问题',
    });
    hybridRetriever.retrieve
      .mockResolvedValueOnce({
        chunks: [stage1Chunk],
        keywordBackend: 'pg',
        vectorResultCount: 1,
        hydeVectorResultCount: 0,
        keywordResultCount: 0,
        fallbackToPg: false,
        skippedChannels: [],
      })
      .mockResolvedValueOnce({
        chunks: [
          {
            ...stage1Chunk,
            similarity: 0.7,
            matched_queries: [1],
          },
          stage1Chunk2,
        ],
        keywordBackend: 'elastic',
        vectorResultCount: 1,
        hydeVectorResultCount: 0,
        keywordResultCount: 1,
        fallbackToPg: false,
        skippedChannels: [],
      });
    rerankerService.rerank.mockResolvedValue([stage1Chunk, stage1Chunk2]);

    const result = await service.retrieveWithStages('kb-1', '原始问题', {
      strategy: {
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: true,
        useHyDE: false,
        allowWeb: true,
        queryCount: 2,
        reason: '测试多查询',
      },
    });

    expect(runtime.embeddings.embedQuery).toHaveBeenNthCalledWith(
      1,
      '改写后的检索问题',
    );
    expect(runtime.embeddings.embedQuery).toHaveBeenNthCalledWith(
      2,
      '实体角度问题',
    );
    expect(hybridRetriever.retrieve).toHaveBeenCalledTimes(2);
    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '原始问题',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'chunk-1',
          matched_queries: [0, 1],
        }),
        expect.objectContaining({
          id: 'chunk-2',
          matched_queries: [1],
        }),
      ]),
      5,
      undefined,
    );
    expect(result.stage1.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
    ]);
    expect(result.stage1Trace).toHaveLength(2);
  });

  it('useHyDE=true 时会把假设答案作为额外向量召回通道', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();
    runtime.embeddings.embedQuery
      .mockResolvedValueOnce([0.9, 0.9, 0.9])
      .mockResolvedValueOnce([0.1, 0.2, 0.3]);

    await service.retrieveWithStages('kb-1', '原始问题', {
      strategy: {
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: false,
        useHyDE: true,
        allowWeb: true,
        reason: '测试 HyDE',
      },
    });

    expect(queryRewriteService.generateHypotheticalAnswer).toHaveBeenCalledWith(
      '原始问题',
      undefined,
    );
    expect(runtime.embeddings.embedQuery).toHaveBeenNthCalledWith(
      1,
      '假设答案文本',
    );
    expect(runtime.embeddings.embedQuery).toHaveBeenNthCalledWith(
      2,
      '改写后的检索问题',
    );
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        hydeQueryEmbedding: [0.9, 0.9, 0.9],
        queryEmbedding: [0.1, 0.2, 0.3],
      }),
    );
  });

  it('retrieve 收到已中断信号时会抛出 AbortError，不会降级为空知识', async () => {
    const { service, runtime, queryRewriteService } = createService();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.retrieve('kb-1', '原始问题', {
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject(createAbortError());

    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
  });
});
