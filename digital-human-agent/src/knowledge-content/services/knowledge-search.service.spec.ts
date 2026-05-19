import { createAbortError } from '@/common/utils';
import type { RetrievalStrategy } from '@/common/rag';
import type { HybridRetrieveResult } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { KnowledgeStage1RetrievalService } from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
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
    queryEmbedding?: number[];
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
    };

    const chunkContextExpansionService = {
      expand: jest.fn((chunks: KnowledgeChunk[]) => Promise.resolve(chunks)),
    };
    const personaStage1RetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        knowledgeCount: 1,
        chunks: [stage1Chunk, stage1Chunk2],
        trace: [
          {
            knowledgeId: 'kb-1',
            queryIndex: 0,
            query: '改写后的检索问题',
            keywords: ['原始问题'],
            angle: 'original' as const,
            vectorBackend: 'pgvector' as const,
            keywordBackend: 'pg' as const,
            graphBackend: 'disabled' as const,
            vectorResultCount: 2,
            keywordResultCount: 1,
            mergedResultCount: 2,
            fallbackToPg: false,
            skippedChannels: [],
          },
        ],
      }),
    };
    const stage1RetrievalService = new KnowledgeStage1RetrievalService(
      runtime as never,
      hybridRetriever as never,
      graphRetriever as never,
    );

    const service = new KnowledgeSearchService(
      runtime as never,
      stage1RetrievalService,
      rerankerService as never,
      queryRewriteService as never,
      chunkContextExpansionService as never,
      personaStage1RetrievalService as never,
    );

    return {
      service,
      runtime,
      hybridRetriever,
      stage1RetrievalService,
      rerankerService,
      queryRewriteService,
      chunkContextExpansionService,
      personaStage1RetrievalService,
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
      allowWeb: true,
      reason: '测试检索策略',
      ...overrides,
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

  it('skipQueryRewrite=true 且 useVector=false 时只走原始问题关键词召回，不调用 LLM rewrite 或 embedding', async () => {
    const { service, runtime, hybridRetriever, queryRewriteService } =
      createService();
    hybridRetriever.retrieve.mockResolvedValue({
      chunks: [stage1Chunk],
      keywordBackend: 'pg',
      vectorResultCount: 0,
      keywordResultCount: 1,
      fallbackToPg: false,
      skippedChannels: ['vector'],
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
    expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
    expect(hybridRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        queryEmbedding: undefined,
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
  });

  it('persona 检索会调用新的 persona stage1 facade，再做全局 rerank', async () => {
    const {
      service,
      rerankerService,
      personaStage1RetrievalService,
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
    expect(personaStage1RetrievalService.retrieve).toHaveBeenCalledWith({
      personaId: 'persona-1',
      retrievalQueries: [
        {
          index: 0,
          query: '改写后的检索问题',
          keywords: ['原始问题'],
          angle: 'original',
        },
      ],
      stage1TopK: undefined,
      threshold: undefined,
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
      [stage1Chunk, stage1Chunk2],
      5,
      undefined,
    );
    expect(result.stage1Trace).toEqual([
      expect.objectContaining({
        knowledgeId: 'kb-1',
      }),
    ]);
  });

  it('persona 未挂载知识库时返回空结果，并保留 fallback 原因', async () => {
    const { service, personaStage1RetrievalService } = createService();
    personaStage1RetrievalService.retrieve.mockResolvedValue({
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

    expect(result.stage1).toEqual([]);
    expect(result.stage2).toEqual([]);
    expect(result.rewrite.reason).toBe('persona persona-1 未挂载知识库');
  });

  it('persona 全局 rerank 失败时会回退 stage1 结果继续返回', async () => {
    const { service, rerankerService } = createService();
    rerankerService.rerank.mockRejectedValue(new Error('rerank failed'));

    const result = await service.retrieveForPersonaWithStages(
      'persona-1',
      '原始问题',
      {
        strategy: baseStrategy(),
      },
    );

    expect(result.stage2).toEqual([stage1Chunk, stage1Chunk2]);
  });

  it('persona stage1 遇到临时错误时向上抛出，交给图层 retryPolicy', async () => {
    const { service, personaStage1RetrievalService } = createService();
    personaStage1RetrievalService.retrieve.mockRejectedValue(
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
    expect(runtime.embeddings.embedQuery).not.toHaveBeenCalled();
  });
});
