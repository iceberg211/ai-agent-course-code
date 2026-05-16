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

  function createService(
    semanticCacheStore?: Record<string, jest.Mock>,
    graphRetriever?: Record<string, jest.Mock>,
  ) {
    const runtime = {
      normalizeRetrieveOptions: jest.fn((options = {}) => ({
        threshold: 0.6,
        rerank: true,
        stage1TopK: 10,
        finalTopK: 5,
        skipQueryRewrite: (options as { skipQueryRewrite?: boolean })
          .skipQueryRewrite === true,
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
      toBoundedNumber: jest.fn((raw, defaultValue, min, max) => {
        const value = Number(raw);
        if (!Number.isFinite(value)) return defaultValue;
        return Math.min(max, Math.max(min, value));
      }),
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

    const chunkContextExpansionService = {
      expand: jest.fn(async (chunks) => chunks),
      expandParentContext: jest.fn(async (chunks) => chunks),
    };

    const service = new KnowledgeSearchService(
      runtime as never,
      hybridRetriever as never,
      rerankerService as never,
      queryRewriteService as never,
      chunkContextExpansionService as never,
      semanticCacheStore as never,
      graphRetriever as never,
    );

    return {
      service,
      runtime,
      hybridRetriever,
      rerankerService,
      queryRewriteService,
      chunkContextExpansionService,
      semanticCacheStore,
      graphRetriever,
    };
  }

  function mockPersonaMountedKnowledge(
    runtime: ReturnType<typeof createService>['runtime'],
    documentRows: Array<Record<string, unknown>> = [],
  ) {
    const mountEq = jest.fn().mockResolvedValue({
      data: [{ knowledge_base_id: 'kb-1' }],
      error: null,
    });
    const mountSelect = jest.fn().mockReturnValue({ eq: mountEq });
    const knowledgeIn = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'kb-1',
          retrieval_config: {
            threshold: 0.6,
            stage1TopK: 10,
            finalTopK: 5,
            rerank: true,
          },
          updated_at: '2026-05-15T10:00:00.000Z',
        },
      ],
      error: null,
    });
    const knowledgeSelect = jest.fn().mockReturnValue({ in: knowledgeIn });
    const documentIn = jest.fn().mockResolvedValue({
      data: documentRows,
      error: null,
    });
    const documentSelect = jest.fn().mockReturnValue({ in: documentIn });

    runtime.supabase.from.mockImplementation((table: string) => {
      if (table === 'persona_knowledge_base') {
        return { select: mountSelect };
      }
      if (table === 'knowledge_base') {
        return { select: knowledgeSelect };
      }
      if (table === 'knowledge_document') {
        return { select: documentSelect };
      }
      throw new Error(`未模拟的数据表：${table}`);
    });

    return {
      mountEq,
      knowledgeIn,
      documentIn,
    };
  }

  function buildRetrievalStrategy() {
    return {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: false,
      useMultiQuery: false,
      useHyDE: false,
      allowWeb: true,
      reason: '测试 persona 缓存',
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

  it('图谱检索开启且 graph-only 时，会把图谱结果纳入 stage1', async () => {
    const originalGraphFlag = process.env.NEO4J_GRAPH_ENABLED;
    process.env.NEO4J_GRAPH_ENABLED = 'true';
    const graphChunk = {
      id: 'chunk-graph',
      content: '甲方应保留审计记录。',
      source: 'contract.md',
      chunk_index: 4,
      category: 'contract',
      similarity: 0.72,
      graph_score: 0.72,
      retrieval_sources: ['graph'],
    };
    const graphRetriever = {
      retrieve: jest.fn().mockResolvedValue([graphChunk]),
    };
    const {
      service,
      runtime,
      hybridRetriever,
      rerankerService,
      queryRewriteService,
    } = createService(undefined, graphRetriever);

    try {
      const result = await service.retrieveWithStages('kb-1', '甲方审计保留', {
        strategy: {
          needRetrieval: true,
          useVector: false,
          useKeyword: false,
          useGraph: true,
          useExactPhrase: false,
          useMultiQuery: false,
          useHyDE: false,
          allowWeb: false,
          reason: '图谱关系检索',
        },
      });

      expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
      expect(hybridRetriever.retrieve).not.toHaveBeenCalled();
      expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
      expect(graphRetriever.retrieve).toHaveBeenCalledWith({
        knowledgeId: 'kb-1',
        retrievalQuery: '甲方审计保留',
        keywordTerms: ['甲方审计保留'],
        matchCount: 10,
        graphMaxHops: undefined,
        graphMode: undefined,
      });
      expect(rerankerService.rerank).not.toHaveBeenCalled();
      expect(result.stage1).toEqual([expect.objectContaining({ id: 'chunk-graph' })]);
      expect(result.stage1Trace[0]).toMatchObject({
        knowledgeId: 'kb-1',
        graphResultCount: 1,
        vectorBackend: 'disabled',
        keywordBackend: 'disabled',
        skippedChannels: expect.arrayContaining(['vector', 'keyword', 'hyde']),
      });
    } finally {
      if (originalGraphFlag === undefined) {
        delete process.env.NEO4J_GRAPH_ENABLED;
      } else {
        process.env.NEO4J_GRAPH_ENABLED = originalGraphFlag;
      }
    }
  });

  it('不启用 rerank 时仍会先做 Query Rewrite 再执行混合检索', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();

    runtime.normalizeRetrieveOptions.mockReturnValue({
      threshold: 0.6,
      rerank: false,
      stage1TopK: 10,
      finalTopK: 5,
      skipQueryRewrite: false,
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

  it('useMultiQuery=false 时不调用 Query Rewrite，只使用原始问题单查询召回', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();
    hybridRetriever.retrieve.mockResolvedValue({
      chunks: [stage1Chunk],
      keywordBackend: 'pg',
      vectorResultCount: 1,
      hydeVectorResultCount: 0,
      keywordResultCount: 1,
      fallbackToPg: false,
      skippedChannels: [],
    });

    const result = await service.retrieveWithStages('kb-1', '原始问题', {
      rerank: false,
      strategy: {
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: false,
        useHyDE: false,
        allowWeb: true,
        queryCount: 5,
        reason: '测试关闭多查询',
      },
    });

    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(runtime.embeddings.embedQuery).toHaveBeenCalledTimes(1);
    expect(runtime.embeddings.embedQuery).toHaveBeenCalledWith('原始问题');
    expect(hybridRetriever.retrieve).toHaveBeenCalledTimes(1);
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalQuery: '原始问题',
        keywordTerms: ['原始问题'],
      }),
    );
    expect(result.retrievalQueries).toEqual([
      {
        index: 0,
        query: '原始问题',
        keywords: ['原始问题'],
        angle: 'original',
      },
    ]);
    expect(result.stage1Trace).toHaveLength(1);
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
      '原始问题',
    );
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        hydeQueryEmbedding: [0.9, 0.9, 0.9],
        queryEmbedding: [0.1, 0.2, 0.3],
      }),
    );
  });

  it('skipQueryRewrite=true 且 useVector=false 时只走原始问题关键词召回，不调用 LLM rewrite 或 embedding', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();
    hybridRetriever.retrieve.mockResolvedValue({
      chunks: [stage1Chunk],
      keywordBackend: 'pg',
      vectorResultCount: 0,
      hydeVectorResultCount: 0,
      keywordResultCount: 1,
      fallbackToPg: false,
      skippedChannels: ['vector', 'hyde'],
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
        useHyDE: false,
        allowWeb: false,
        reason: '安全关键词评估',
      },
      skipQueryRewrite: true,
    });

    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(queryRewriteService.generateHypotheticalAnswer).not.toHaveBeenCalled();
    expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        queryEmbedding: undefined,
        hydeQueryEmbedding: undefined,
        retrievalQuery: '原始问题',
        keywordTerms: ['原始问题'],
        useVector: false,
        useKeyword: true,
        useExactPhrase: true,
      }),
    );
    expect(result.rewrite.reason).toBe('显式跳过 Query Rewrite');
    expect(result.options.skipQueryRewrite).toBe(true);
    expect(result.stage1Trace[0]).toMatchObject({
      vectorBackend: 'disabled',
      vectorResultCount: 0,
    });
    expect(result.stage1[0].vector_backend).toBeUndefined();
  });

  it('skipQueryRewrite=true 时会为中文长问题生成本地关键词', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();
    hybridRetriever.retrieve.mockResolvedValue({
      chunks: [stage1Chunk],
      keywordBackend: 'pg',
      vectorResultCount: 0,
      hydeVectorResultCount: 0,
      keywordResultCount: 1,
      fallbackToPg: false,
      skippedChannels: ['vector', 'hyde'],
    });

    await service.retrieveWithStages(
      'kb-1',
      '示例服务协议里协议终止后的试用数据应如何处理？',
      {
        rerank: false,
        strategy: {
          needRetrieval: true,
          useVector: false,
          useKeyword: true,
          useGraph: false,
          useExactPhrase: true,
          useMultiQuery: false,
          useHyDE: false,
          allowWeb: false,
          reason: '安全关键词评估',
        },
        skipQueryRewrite: true,
      },
    );

    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalQuery: '示例服务协议里协议终止后的试用数据应如何处理？',
        keywordTerms: expect.arrayContaining(['协议终止', '试用数据']),
        useVector: false,
        useKeyword: true,
      }),
    );
  });

  it('useKeyword=false 时 trace 标记 keyword disabled，但 chunk 元数据不写入 disabled backend', async () => {
    const { service, hybridRetriever } = createService();
    hybridRetriever.retrieve.mockResolvedValue({
      chunks: [
        {
          ...stage1Chunk,
          retrieval_sources: ['vector'],
        },
      ],
      keywordBackend: 'disabled',
      vectorResultCount: 1,
      hydeVectorResultCount: 0,
      keywordResultCount: 0,
      fallbackToPg: false,
      skippedChannels: ['keyword', 'hyde'],
    });

    const result = await service.retrieveWithStages('kb-1', '原始问题', {
      rerank: false,
      strategy: {
        needRetrieval: true,
        useVector: true,
        useKeyword: false,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: false,
        useHyDE: false,
        allowWeb: false,
        reason: '只测向量通道',
      },
    });

    expect(result.stage1Trace[0]).toMatchObject({
      keywordBackend: 'disabled',
      keywordResultCount: 0,
    });
    expect(result.stage1[0].keyword_backend).toBeUndefined();
  });

  it('chunkContextWindow 开启时只扩展最终 stage2，上游召回和 rerank 仍保持原始问题', async () => {
    const { service, chunkContextExpansionService, rerankerService } =
      createService();
    const expandedStage2 = [
      {
        ...stage1Chunk,
        id: 'chunk-0',
        chunk_index: -1,
        context_expanded: true,
      },
      stage1Chunk,
      stage1Chunk2,
    ];
    chunkContextExpansionService.expand.mockResolvedValue(expandedStage2);

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
        chunkContextWindow: 1,
        reason: '测试邻近上下文',
      },
    });

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '原始问题',
      expect.any(Array),
      5,
      undefined,
    );
    expect(chunkContextExpansionService.expand).toHaveBeenCalledWith(
      [stage1Chunk, stage1Chunk2],
      1,
    );
    expect(result.stage1.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
    ]);
    expect(result.stage2).toBe(expandedStage2);
  });

  it('parentContext 开启时用 parent context 扩展最终 stage2，并优先于相邻窗口', async () => {
    const { service, chunkContextExpansionService, rerankerService } =
      createService();
    const parentStage2 = [
      {
        ...stage1Chunk,
        parent_context: true,
        content: '上文\n\n雁门关事件相关片段\n\n下文',
      },
      {
        ...stage1Chunk2,
        parent_context: true,
        content: '前文\n\n萧峰结局相关片段\n\n后文',
      },
    ];
    chunkContextExpansionService.expandParentContext.mockResolvedValue(
      parentStage2,
    );

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
        parentContext: true,
        parentContextMaxChars: 2000,
        chunkContextWindow: 1,
        reason: '测试 parent context',
      },
    });

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '原始问题',
      expect.any(Array),
      5,
      undefined,
    );
    expect(chunkContextExpansionService.expandParentContext).toHaveBeenCalledWith(
      [stage1Chunk, stage1Chunk2],
      2000,
    );
    expect(chunkContextExpansionService.expand).not.toHaveBeenCalled();
    expect(result.stage2).toBe(parentStage2);
  });

  it('persona 语义缓存精确命中时直接返回缓存检索结果', async () => {
    const strategy = buildRetrievalStrategy();
    const cachedResult = {
      query: '原始问题',
      retrievalQuery: '缓存检索问题',
      retrievalQueries: [],
      rewrite: {
        originalQuery: '原始问题',
        rewrittenQuery: '缓存检索问题',
        keywords: ['原始问题'],
        expandedQueries: [],
        changed: true,
        reason: '来自缓存',
      },
      options: {
        threshold: 0.6,
        rerank: true,
        stage1TopK: 10,
        finalTopK: 5,
        skipQueryRewrite: false,
        strategy,
      },
      stage1Trace: [],
      stage1: [stage1Chunk],
      stage2: [stage1Chunk],
    };
    const semanticCacheStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      getByKey: jest.fn().mockResolvedValue({
        cacheKey: 'rag-semantic:v1:cached',
        payload: { result: cachedResult },
        similarity: null,
        expiresAt: '2026-05-15T13:00:00.000Z',
      }),
      findSimilar: jest.fn(),
      upsert: jest.fn(),
    };
    const {
      service,
      runtime,
      hybridRetriever,
      queryRewriteService,
      rerankerService,
    } = createService(semanticCacheStore);
    mockPersonaMountedKnowledge(runtime);

    const result = await service.retrieveForPersonaWithStages(
      'persona-1',
      '原始问题',
      { strategy },
    );

    expect(result.stage2).toEqual([stage1Chunk]);
    expect(result.cache).toMatchObject({
      enabled: true,
      lookup: 'exact-hit',
      cacheKey: 'rag-semantic:v1:cached',
      written: false,
    });
    expect(semanticCacheStore.getByKey).toHaveBeenCalledWith(
      expect.stringMatching(/^rag-semantic:v1:/),
    );
    expect(semanticCacheStore.findSimilar).not.toHaveBeenCalled();
    expect(semanticCacheStore.upsert).not.toHaveBeenCalled();
    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
    expect(hybridRetriever.retrieve).not.toHaveBeenCalled();
    expect(rerankerService.rerank).not.toHaveBeenCalled();
  });

  it('persona 语义缓存未命中时走实时检索并写入缓存', async () => {
    const strategy = buildRetrievalStrategy();
    const semanticCacheStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      getByKey: jest.fn().mockResolvedValue(null),
      findSimilar: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ written: true }),
    };
    const {
      service,
      runtime,
      hybridRetriever,
      queryRewriteService,
      semanticCacheStore: cacheStore,
    } = createService(semanticCacheStore);
    mockPersonaMountedKnowledge(runtime, [
      {
        id: 'doc-1',
        knowledge_base_id: 'kb-1',
        status: 'completed',
        chunk_count: 2,
        created_at: '2026-05-15T11:00:00.000Z',
      },
    ]);

    const result = await service.retrieveForPersonaWithStages(
      'persona-1',
      '原始问题',
      { strategy },
    );

    expect(cacheStore?.findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'persona-1',
        queryEmbedding: [0.1, 0.2, 0.3],
        mountedKnowledgeBaseFingerprints: [
          expect.stringMatching(/^kb-fingerprint:v1:kb-1:/),
        ],
      }),
    );
    expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
    expect(hybridRetriever.retrieve).toHaveBeenCalled();
    expect(cacheStore?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '原始问题',
        queryEmbedding: [0.1, 0.2, 0.3],
        mountedKnowledgeBaseIds: ['kb-1'],
        payload: expect.objectContaining({
          stage1ChunkIds: ['chunk-1', 'chunk-2'],
          stage2ChunkIds: ['chunk-1', 'chunk-2'],
          result: expect.objectContaining({
            query: '原始问题',
            retrievalQuery: '原始问题',
          }),
        }),
      }),
    );
    expect(result.cache).toMatchObject({
      enabled: true,
      lookup: 'miss',
      written: true,
    });
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
