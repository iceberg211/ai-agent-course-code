import { createAbortError } from '@/common/utils';
import type { RetrievalStrategy } from '@/common/rag';
import { KnowledgeSearchService } from '@/knowledge-content/services/retrieval/knowledge-search.service';
import type {
  KnowledgeChunk,
  RetrieveKnowledgeOptions,
} from '@/knowledge-content/types/knowledge-content.types';

describe('KnowledgeSearchService', () => {
  const hybridChunk: KnowledgeChunk = {
    id: 'chunk-1',
    content: '雁门关事件相关片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.92,
  };
  const hybridChunk2: KnowledgeChunk = {
    id: 'chunk-2',
    content: '萧峰结局相关片段',
    source: 'test.md',
    chunk_index: 1,
    category: null,
    similarity: 0.83,
  };

  function createService() {
    const runtime = {
      normalizeRetrieveOptions: jest.fn(
        (
          options: Pick<
            RetrieveKnowledgeOptions,
            | 'rerank'
            | 'retrievalLimit'
            | 'stage1TopK'
            | 'rerankLimit'
            | 'finalTopK'
            | 'threshold'
            | 'skipQueryRewrite'
          > = {},
        ) => ({
          threshold: options.threshold ?? 0.6,
          rerank: options.rerank !== false,
          retrievalLimit: options.retrievalLimit ?? options.stage1TopK ?? 10,
          rerankLimit: options.rerankLimit ?? options.finalTopK ?? 5,
          skipQueryRewrite: options.skipQueryRewrite === true,
        }),
      ),
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      embeddings: {
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      },
      toBoundedNumber: jest.fn(
        (raw: unknown, defaultValue: number, min: number, max: number) => {
          const value = Number(raw);
          if (!Number.isFinite(value)) return defaultValue;
          return Math.min(max, Math.max(min, value));
        },
      ),
    };

    const rerankerService = {
      rerank: jest
        .fn<
          Promise<KnowledgeChunk[]>,
          [string, KnowledgeChunk[], number, AbortSignal?]
        >()
        .mockResolvedValue([hybridChunk, hybridChunk2]),
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
    };

    const chunkContextExpansionService = {
      expand: jest.fn((chunks: KnowledgeChunk[]) => Promise.resolve(chunks)),
    };

    const hybridRetrieverService = {
      retrieveForKnowledge: jest.fn().mockResolvedValue({
        chunks: [hybridChunk, hybridChunk2],
        trace: [
          {
            knowledgeId: 'kb-1',
            queryIndex: 0,
            query: '改写后的检索问题',
            keywords: ['原始问题'],
            angle: 'original',
            vectorBackend: 'pgvector',
            keywordBackend: 'pg',
            graphBackend: 'disabled',
            vectorResultCount: 2,
            keywordResultCount: 1,
            mergedResultCount: 2,
            fallbackToPg: false,
            skippedChannels: [],
          },
        ],
      }),
      retrieveForPersona: jest.fn().mockResolvedValue({
        knowledgeCount: 1,
        chunks: [hybridChunk, hybridChunk2],
        trace: [
          {
            knowledgeId: 'kb-1',
            queryIndex: 0,
            query: '改写后的检索问题',
            keywords: ['原始问题'],
            angle: 'original',
            vectorBackend: 'pgvector',
            keywordBackend: 'pg',
            graphBackend: 'disabled',
            vectorResultCount: 2,
            keywordResultCount: 1,
            mergedResultCount: 2,
            fallbackToPg: false,
            skippedChannels: [],
          },
        ],
      }),
    };

    const service = new KnowledgeSearchService(
      runtime as never,
      hybridRetrieverService as never,
      rerankerService as never,
      queryRewriteService as never,
    );

    return {
      service,
      runtime,
      hybridRetrieverService,
      rerankerService,
      queryRewriteService,
    };
  }

  function baseStrategy(
    overrides: Partial<RetrievalStrategy> = {},
  ): RetrievalStrategy {
    return {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: false,
      useMultiQuery: false,
      allowWeb: true,
      reason: '测试检索策略',
      ...overrides,
    };
  }

  it('retrieveWithStages 会使用改写后的 query 做召回，但 rerank 仍基于原始问题', async () => {
    const {
      service,
      hybridRetrieverService,
      rerankerService,
      queryRewriteService,
    } = createService();

    const result = await service.retrieveWithStages('kb-1', '原始问题');

    expect(queryRewriteService.rewrite).toHaveBeenCalledWith(
      '原始问题',
      undefined,
    );
    expect(hybridRetrieverService.retrieveForKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeId: 'kb-1',
        retrievalQueries: [
          expect.objectContaining({
            query: '改写后的检索问题',
            keywords: ['原始问题'],
          }),
        ],
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

  it('图谱检索开启且 graph-only 时，会把图谱结果纳入混合检索结果', async () => {
    const graphChunk: KnowledgeChunk = {
      id: 'chunk-graph',
      content: '甲方应保留审计记录。',
      source: 'contract.md',
      chunk_index: 4,
      category: 'contract',
      similarity: 0.72,
      graph_score: 0.72,
      retrieval_sources: ['graph'],
    };
    const {
      service,
      hybridRetrieverService,
      rerankerService,
      queryRewriteService,
    } = createService();
    hybridRetrieverService.retrieveForKnowledge.mockResolvedValue({
      chunks: [graphChunk],
      trace: [
        {
          knowledgeId: 'kb-1',
          queryIndex: 0,
          query: '甲方审计保留',
          keywords: ['甲方审计保留'],
          angle: 'original',
          vectorBackend: 'disabled',
          keywordBackend: 'disabled',
          graphBackend: 'neo4j',
          graphResultCount: 1,
        },
      ],
    });

    const originalGraphFlag = process.env.NEO4J_GRAPH_ENABLED;
    process.env.NEO4J_GRAPH_ENABLED = 'true';

    try {
      const result = await service.retrieveWithStages('kb-1', '甲方审计保留', {
        signal: new AbortController().signal,
        strategy: {
          needRetrieval: true,
          useVector: false,
          useKeyword: false,
          useGraph: true,
          useExactPhrase: false,
          useMultiQuery: false,
          allowWeb: false,
          reason: '图谱关系检索',
        },
      });

      expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
      expect(hybridRetrieverService.retrieveForKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeId: 'kb-1',
          strategy: expect.objectContaining({
            useVector: false,
            useKeyword: false,
            useGraph: true,
          }),
        }),
      );
      expect(rerankerService.rerank).not.toHaveBeenCalled();
      expect(result.hybridChunks).toEqual([
        expect.objectContaining({ id: 'chunk-graph' }),
      ]);
      expect(result.retrievalTrace[0]).toMatchObject({
        knowledgeId: 'kb-1',
        graphResultCount: 1,
        graphBackend: 'neo4j',
        vectorBackend: 'disabled',
        keywordBackend: 'disabled',
      });
    } finally {
      if (originalGraphFlag === undefined) {
        delete process.env.NEO4J_GRAPH_ENABLED;
      } else {
        process.env.NEO4J_GRAPH_ENABLED = originalGraphFlag;
      }
    }
  });

  it('multi-query 会逐条召回并按 chunk.id 合并去重，rerank 仍使用原始问题', async () => {
    const {
      service,
      hybridRetrieverService,
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
    hybridRetrieverService.retrieveForKnowledge.mockResolvedValue({
      chunks: [
        {
          ...hybridChunk,
          matched_queries: [0, 1],
        },
        hybridChunk2,
      ],
      trace: [
        {
          knowledgeId: 'kb-1',
          queryIndex: 0,
          query: '改写后的检索问题',
          keywords: ['原始问题'],
          angle: 'original',
          vectorBackend: 'pgvector',
          keywordBackend: 'pg',
          graphBackend: 'disabled',
          vectorResultCount: 1,
          keywordResultCount: 0,
          mergedResultCount: 1,
          fallbackToPg: false,
          skippedChannels: [],
        },
        {
          knowledgeId: 'kb-1',
          queryIndex: 1,
          query: '实体角度问题',
          keywords: ['实体角度'],
          angle: 'entity',
          vectorBackend: 'pgvector',
          keywordBackend: 'pg',
          graphBackend: 'disabled',
          vectorResultCount: 1,
          keywordResultCount: 1,
          mergedResultCount: 2,
          fallbackToPg: false,
          skippedChannels: [],
        },
      ],
    });

    const result = await service.retrieveWithStages('kb-1', '原始问题', {
      strategy: {
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: true,
        allowWeb: true,
        queryCount: 2,
        reason: '测试多查询',
      },
    });

    expect(hybridRetrieverService.retrieveForKnowledge).toHaveBeenCalledTimes(1);
    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '原始问题',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'chunk-1',
          matched_queries: [0, 1],
        }),
        expect.objectContaining({
          id: 'chunk-2',
        }),
      ]),
      5,
      undefined,
    );
    expect(result.hybridChunks.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
    ]);
    expect(result.retrievalTrace).toHaveLength(2);
  });

  it('skipQueryRewrite=true 且 useVector=false 时只走原始问题关键词召回，不调用 LLM rewrite 或 embedding', async () => {
    const { service, hybridRetrieverService, queryRewriteService } =
      createService();
    hybridRetrieverService.retrieveForKnowledge.mockResolvedValue({
      chunks: [hybridChunk],
      trace: [
        {
          knowledgeId: 'kb-1',
          queryIndex: 0,
          query: '原始问题',
          keywords: ['原始问题'],
          angle: 'original',
          vectorBackend: 'disabled',
          keywordBackend: 'pg',
          graphBackend: 'disabled',
          vectorResultCount: 0,
          keywordResultCount: 1,
          mergedResultCount: 1,
          fallbackToPg: false,
          skippedChannels: ['vector'],
        },
      ],
    });

    const result = await service.retrieveWithStages('kb-1', '原始问题', {
      rerank: false,
      strategy: {
        needRetrieval: true,
        useVector: false,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: true,
        useMultiQuery: false,
        allowWeb: false,
        reason: '安全关键词评估',
      },
      skipQueryRewrite: true,
    });

    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(hybridRetrieverService.retrieveForKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeId: 'kb-1',
        retrievalQueries: [
          expect.objectContaining({
            query: '原始问题',
            keywords: ['原始问题'],
          }),
        ],
        strategy: expect.objectContaining({
          useVector: false,
          useKeyword: true,
          useExactPhrase: true,
        }),
      }),
    );
    expect(result.rewrite.reason).toBe('显式跳过 Query Rewrite');
    expect(result.options.skipQueryRewrite).toBe(true);
    expect(result.retrievalTrace[0]).toMatchObject({
      vectorBackend: 'disabled',
      vectorResultCount: 0,
    });
  });

  it('persona 检索会调用新的 persona 混合检索，再做全局重排', async () => {
    const {
      service,
      rerankerService,
      hybridRetrieverService,
      queryRewriteService,
    } = createService();

    const result = await service.retrieveForPersonaWithStages(
      'persona-1',
      '原始问题',
      {
        strategy: baseStrategy({
          useMultiQuery: true,
          queryCount: 2,
        }),
      },
    );

    expect(queryRewriteService.rewrite).toHaveBeenCalledWith(
      '原始问题',
      undefined,
    );
    expect(hybridRetrieverService.retrieveForPersona).toHaveBeenCalledWith({
      personaId: 'persona-1',
      retrievalQueries: [
        {
          index: 0,
          query: '改写后的检索问题',
          keywords: ['原始问题'],
          angle: 'original',
        },
      ],
      retrievalLimit: 10,
      threshold: 0.6,
      channels: {
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: false,
      },
      signal: undefined,
    });
    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '原始问题',
      [hybridChunk, hybridChunk2],
      5,
      undefined,
    );
    expect(result.retrievalTrace).toEqual([
      expect.objectContaining({
        knowledgeId: 'kb-1',
      }),
    ]);
  });

  it('persona 未挂载知识库时返回空结果，并保留 fallback 原因', async () => {
    const { service, hybridRetrieverService } = createService();
    hybridRetrieverService.retrieveForPersona.mockResolvedValue({
      knowledgeCount: 0,
      chunks: [],
      trace: [],
    });

    const result = await service.retrieveForPersonaWithStages(
      'persona-1',
      '原始问题',
      {
        strategy: baseStrategy(),
      },
    );

    expect(result.hybridChunks).toEqual([]);
    expect(result.rerankedChunks).toEqual([]);
    expect(result.rewrite.reason).toBe('persona persona-1 未挂载知识库');
  });

  it('persona 全局 rerank 失败时会回退混合检索结果继续返回', async () => {
    const { service, rerankerService } = createService();
    rerankerService.rerank.mockRejectedValue(new Error('rerank failed'));

    const result = await service.retrieveForPersonaWithStages(
      'persona-1',
      '原始问题',
      {
        strategy: baseStrategy(),
      },
    );

    expect(result.rerankedChunks).toEqual([hybridChunk, hybridChunk2]);
  });

  it('persona 混合检索遇到临时错误时向上抛出，交给图层 retryPolicy', async () => {
    const { service, hybridRetrieverService } = createService();
    hybridRetrieverService.retrieveForPersona.mockRejectedValue(
      new Error('fetch failed'),
    );

    await expect(
      service.retrieveForPersonaWithStages('persona-1', '原始问题', {
        strategy: baseStrategy(),
      }),
    ).rejects.toThrow(/fetch failed/);
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
  });
});
