import { createAbortError } from '@/common/utils';
import type { RetrievalStrategy } from '@/common/rag';
import type { HybridRetrieveResult } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { KnowledgeStage1RetrievalService } from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
import { PersonaKnowledgeConfigService } from '@/knowledge-content/services/persona-knowledge-config.service';
import type {
  KnowledgeChunk,
  RetrieveKnowledgeOptions,
} from '@/knowledge-content/types/knowledge-content.types';

describe('KnowledgeSearchService', () => {
  type GraphRetrieverMock = {
    isEnabled: jest.Mock<boolean, []>;
    retrieve: jest.Mock<Promise<KnowledgeChunk[]>, [unknown]>;
  };

  type GraphRetrieveCall = {
    knowledgeId: string;
    retrievalQuery: string;
    keywordTerms: string[];
    matchCount: number;
    graphMaxHops?: number;
    graphMode?: 'neighbors' | 'path';
    signal?: AbortSignal;
  };

  type HybridRetrieveCall = {
    retrievalQuery: string;
    keywordTerms: string[];
    useVector?: boolean;
    useKeyword?: boolean;
  };

  const stage1Chunk: KnowledgeChunk = {
    id: 'chunk-1',
    content: '雁门关事件相关片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.92,
  };
  const stage1Chunk2: KnowledgeChunk = {
    id: 'chunk-2',
    content: '萧峰结局相关片段',
    source: 'test.md',
    chunk_index: 1,
    category: null,
    similarity: 0.83,
  };

  function createService(graphRetriever?: GraphRetrieverMock) {
    const runtime = {
      normalizeRetrieveOptions: jest.fn(
        (
          options: Pick<
            RetrieveKnowledgeOptions,
            | 'rerank'
            | 'stage1TopK'
            | 'finalTopK'
            | 'threshold'
            | 'skipQueryRewrite'
          > = {},
        ) => ({
          threshold: options.threshold ?? 0.6,
          rerank: options.rerank !== false,
          stage1TopK: options.stage1TopK ?? 10,
          finalTopK: options.finalTopK ?? 5,
          skipQueryRewrite: options.skipQueryRewrite === true,
        }),
      ),
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      embeddings: {
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      },
      supabase: {
        from: jest.fn(),
      },
      toBoundedNumber: jest.fn(
        (raw: unknown, defaultValue: number, min: number, max: number) => {
          const value = Number(raw);
          if (!Number.isFinite(value)) return defaultValue;
          return Math.min(max, Math.max(min, value));
        },
      ),
    };

    const hybridRetriever = {
      retrieve: jest
        .fn<Promise<HybridRetrieveResult>, [unknown]>()
        .mockResolvedValue({
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
      rerank: jest
        .fn<
          Promise<KnowledgeChunk[]>,
          [string, KnowledgeChunk[], number, AbortSignal?]
        >()
        .mockResolvedValue([stage1Chunk, stage1Chunk2]),
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
      expand: jest.fn((chunks: KnowledgeChunk[]) => Promise.resolve(chunks)),
    };
    const stage1RetrievalService = new KnowledgeStage1RetrievalService(
      runtime as never,
      hybridRetriever as never,
      graphRetriever as never,
    );
    const personaKnowledgeConfigService = new PersonaKnowledgeConfigService(
      runtime as never,
    );

    const service = new KnowledgeSearchService(
      runtime as never,
      stage1RetrievalService,
      rerankerService as never,
      queryRewriteService as never,
      chunkContextExpansionService as never,
      personaKnowledgeConfigService,
    );

    return {
      service,
      runtime,
      hybridRetriever,
      stage1RetrievalService,
      rerankerService,
      queryRewriteService,
      chunkContextExpansionService,
      personaKnowledgeConfigService,
      graphRetriever,
    };
  }

  function createGraphRetriever(
    chunks: KnowledgeChunk[] = [],
  ): GraphRetrieverMock {
    return {
      isEnabled: jest.fn<boolean, []>().mockReturnValue(true),
      retrieve: jest
        .fn<Promise<KnowledgeChunk[]>, [unknown]>()
        .mockResolvedValue(chunks),
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
      useHyDE: false,
      allowWeb: true,
      reason: '测试检索策略',
      ...overrides,
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

  function mockPersonaMountedKnowledgeIds(
    runtime: ReturnType<typeof createService>['runtime'],
    knowledgeIds: string[],
  ) {
    const mountEq = jest.fn().mockResolvedValue({
      data: knowledgeIds.map((knowledgeId) => ({
        knowledge_base_id: knowledgeId,
      })),
      error: null,
    });
    const mountSelect = jest.fn().mockReturnValue({ eq: mountEq });
    const knowledgeIn = jest.fn().mockResolvedValue({
      data: knowledgeIds.map((knowledgeId) => ({
        id: knowledgeId,
        retrieval_config: {
          threshold: 0.6,
          stage1TopK: 10,
          finalTopK: 5,
          rerank: true,
        },
        updated_at: '2026-05-15T10:00:00.000Z',
      })),
      error: null,
    });
    const knowledgeSelect = jest.fn().mockReturnValue({ in: knowledgeIn });

    runtime.supabase.from.mockImplementation((table: string) => {
      if (table === 'persona_knowledge_base') {
        return { select: mountSelect };
      }
      if (table === 'knowledge_base') {
        return { select: knowledgeSelect };
      }
      throw new Error(`未模拟的数据表：${table}`);
    });

    return {
      mountEq,
      knowledgeIn,
    };
  }

  function buildRetrievalStrategy(): RetrievalStrategy {
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

  it('retrieveWithStages 会把 AbortSignal 传给 stage1 检索通道', async () => {
    const { service, hybridRetriever } = createService();
    const signal = new AbortController().signal;

    await service.retrieveWithStages('kb-1', '原始问题', {
      signal,
      skipQueryRewrite: true,
    });

    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
      }),
    );
  });

  it('图谱检索开启且 graph-only 时，会把图谱结果纳入 stage1', async () => {
    const originalGraphFlag = process.env.NEO4J_GRAPH_ENABLED;
    process.env.NEO4J_GRAPH_ENABLED = 'true';
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
    const graphRetriever = createGraphRetriever([graphChunk]);
    const {
      service,
      runtime,
      hybridRetriever,
      rerankerService,
      queryRewriteService,
    } = createService(graphRetriever);

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
          useHyDE: false,
          allowWeb: false,
          reason: '图谱关系检索',
        },
      });

      expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
      expect(hybridRetriever.retrieve).not.toHaveBeenCalled();
      expect(queryRewriteService.rewrite).not.toHaveBeenCalled();
      expect(graphRetriever.retrieve).toHaveBeenCalledTimes(1);
      const graphRetrieveCall = graphRetriever.retrieve.mock.calls[0]?.[0] as
        | GraphRetrieveCall
        | undefined;
      expect(graphRetrieveCall).toMatchObject({
        knowledgeId: 'kb-1',
        retrievalQuery: '甲方审计保留',
        keywordTerms: ['甲方审计保留'],
        matchCount: 10,
        graphMaxHops: undefined,
        graphMode: undefined,
      });
      expect(graphRetrieveCall?.signal).toBeInstanceOf(AbortSignal);
      expect(rerankerService.rerank).not.toHaveBeenCalled();
      expect(result.stage1).toEqual([
        expect.objectContaining({ id: 'chunk-graph' }),
      ]);
      expect(result.stage1Trace[0]).toMatchObject({
        knowledgeId: 'kb-1',
        graphResultCount: 1,
        graphBackend: 'neo4j',
        vectorBackend: 'disabled',
        keywordBackend: 'disabled',
      });
      expect(result.stage1Trace[0]?.skippedChannels).toContain('vector');
      expect(result.stage1Trace[0]?.skippedChannels).toContain('keyword');
      expect(result.stage1Trace[0]?.skippedChannels).toContain('hyde');
    } finally {
      if (originalGraphFlag === undefined) {
        delete process.env.NEO4J_GRAPH_ENABLED;
      } else {
        process.env.NEO4J_GRAPH_ENABLED = originalGraphFlag;
      }
    }
  });

  it('图谱结果进入统一 rank 融合，不会用原始 graph_score 压过混合检索', async () => {
    const originalGraphFlag = process.env.NEO4J_GRAPH_ENABLED;
    process.env.NEO4J_GRAPH_ENABLED = 'true';
    const hybridChunk: KnowledgeChunk = {
      id: 'chunk-hybrid',
      content: '向量和关键词共同命中的验收付款条款。',
      source: 'contract.md',
      chunk_index: 1,
      category: 'contract',
      similarity: 0.91,
      hybrid_score: 0.032,
      retrieval_sources: ['vector', 'keyword'],
    };
    const graphChunk: KnowledgeChunk = {
      id: 'chunk-graph',
      content: '图谱关系命中的审计记录条款。',
      source: 'contract.md',
      chunk_index: 4,
      category: 'contract',
      similarity: 0,
      graph_score: 99,
      retrieval_sources: ['graph'],
    };
    const graphRetriever = createGraphRetriever([graphChunk]);
    const { service, hybridRetriever, rerankerService } =
      createService(graphRetriever);
    hybridRetriever.retrieve.mockResolvedValue({
      chunks: [hybridChunk],
      keywordBackend: 'pg',
      vectorResultCount: 1,
      hydeVectorResultCount: 0,
      keywordResultCount: 1,
      fallbackToPg: false,
      skippedChannels: [],
    });

    try {
      const result = await service.retrieveWithStages('kb-1', '验收付款关系', {
        rerank: false,
        skipQueryRewrite: true,
        strategy: baseStrategy({
          useGraph: true,
          useKeyword: true,
          useVector: true,
          allowWeb: false,
        }),
      });

      expect(rerankerService.rerank).not.toHaveBeenCalled();
      expect(result.stage1.map((chunk) => chunk.id)).toEqual([
        'chunk-hybrid',
        'chunk-graph',
      ]);
      expect(result.stage1[1].hybrid_score).toBeLessThan(0.032);
      expect(result.stage1[1].graph_score).toBe(99);
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
    expect(
      queryRewriteService.generateHypotheticalAnswer,
    ).not.toHaveBeenCalled();
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
    const retrieveCall = hybridRetriever.retrieve.mock.calls[0]?.[0] as
      | HybridRetrieveCall
      | undefined;
    expect(retrieveCall).toMatchObject({
      retrievalQuery: '示例服务协议里协议终止后的试用数据应如何处理？',
      useVector: false,
      useKeyword: true,
    });
    expect(retrieveCall?.keywordTerms).toContain('协议终止');
    expect(retrieveCall?.keywordTerms).toContain('试用数据');
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

  it('persona 挂载查询遇到临时错误时向上抛出，交给图层 retryPolicy', async () => {
    const { service, runtime } = createService();
    const mountEq = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'fetch failed' },
    });
    const mountSelect = jest.fn().mockReturnValue({ eq: mountEq });
    runtime.supabase.from.mockReturnValue({ select: mountSelect });

    await expect(
      service.retrieveForPersonaWithStages('persona-1', '原始问题', {
        strategy: buildRetrievalStrategy(),
      }),
    ).rejects.toThrow(/fetch failed/);
  });

  it('persona stage1 单库临时错误会向上抛出，避免被当成无结果', async () => {
    const { service, runtime, stage1RetrievalService } = createService();
    mockPersonaMountedKnowledge(runtime);
    jest
      .spyOn(stage1RetrievalService, 'retrieveForKnowledge')
      .mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      service.retrieveForPersonaWithStages('persona-1', '原始问题', {
        strategy: buildRetrievalStrategy(),
      }),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it('persona 多知识库检索会限制并发数量', async () => {
    const originalConcurrency = process.env.RAG_PERSONA_KB_CONCURRENCY;
    process.env.RAG_PERSONA_KB_CONCURRENCY = '2';
    const { service, runtime, stage1RetrievalService, rerankerService } =
      createService();
    mockPersonaMountedKnowledgeIds(runtime, ['kb-1', 'kb-2', 'kb-3', 'kb-4']);

    let inFlight = 0;
    let maxInFlight = 0;
    jest
      .spyOn(stage1RetrievalService, 'retrieveForKnowledge')
      .mockImplementation(async ({ knowledgeId }: { knowledgeId: string }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return {
          chunks: [
            {
              ...stage1Chunk,
              id: `chunk-${knowledgeId}`,
              knowledge_base_id: knowledgeId,
            },
          ],
          trace: [],
        };
      });

    try {
      await service.retrieveForPersonaWithStages('persona-1', '原始问题', {
        rerank: false,
        strategy: buildRetrievalStrategy(),
      });

      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(stage1RetrievalService.retrieveForKnowledge).toHaveBeenCalledTimes(
        4,
      );
      expect(rerankerService.rerank).not.toHaveBeenCalled();
    } finally {
      if (originalConcurrency === undefined) {
        delete process.env.RAG_PERSONA_KB_CONCURRENCY;
      } else {
        process.env.RAG_PERSONA_KB_CONCURRENCY = originalConcurrency;
      }
    }
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
