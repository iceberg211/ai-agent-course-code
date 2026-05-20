import { HybridRetrieverService } from '@/knowledge/services/retrieval/hybrid-retriever.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type { RetrievalStrategy } from '@/common/rag';

const sampleChunk = {
  id: 'chunk-keyword',
  content: '合同中关于删除时限的条款',
  source: 'contract.md',
  chunk_index: 0,
  category: 'legal',
  similarity: 0,
  keyword_score: 12,
  retrieval_sources: ['keyword'] as const,
};

describe('HybridRetrieverService', () => {
  const strategy: RetrievalStrategy = {
    needRetrieval: true,
    useVector: true,
    useKeyword: true,
    useGraph: true,
    useExactPhrase: false,
    useMultiQuery: false,
    allowWeb: false,
    reason: '测试',
  };

  function createService(options?: {
    backend?: string;
    elasticsearchEnabled?: boolean;
    elasticResult?: unknown;
    pgResult?: unknown[];
    elasticError?: Error;
    vectorResult?: unknown[];
  }) {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'HYBRID_KEYWORD_BACKEND') {
          return options?.backend ?? 'pg';
        }
        return undefined;
      }),
    };

    const defaultElasticResult = {
      hits: {
        hits: [
          {
            _id: sampleChunk.id,
            _source: {
              id: sampleChunk.id,
              content: sampleChunk.content,
              source: sampleChunk.source,
              chunk_index: sampleChunk.chunk_index,
              category: sampleChunk.category,
              knowledge_base_id: 'kb-1',
            },
            _score: 12,
          },
        ],
      },
    };

    const elasticsearchClient = {
      search: options?.elasticError
        ? jest.fn().mockRejectedValue(options.elasticError)
        : jest.fn().mockResolvedValue(options?.elasticResult ?? defaultElasticResult),
    };

    const elasticsearchService = {
      isEnabled: jest
        .fn()
        .mockReturnValue(options?.elasticsearchEnabled ?? false),
      getClient: jest.fn().mockReturnValue(elasticsearchClient),
      ensureKnowledgeChunkIndex: jest.fn().mockResolvedValue(undefined),
      getKnowledgeChunkReadAlias: jest
        .fn()
        .mockReturnValue('digital-human-knowledge-chunk-read'),
    };

    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(options?.pgResult ?? [sampleChunk]),
      getRawMany: jest.fn().mockResolvedValue(options?.pgResult ?? [sampleChunk]),
    };

    const chunkRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };

    const rpcMock = jest.fn().mockResolvedValue({
      data: options?.vectorResult ?? [],
      error: null,
    });

    const runtime = {
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      embeddings: {
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      },
      supabase: {
        rpc: rpcMock,
      },
    };

    const graphRetriever = {
      isEnabled: jest.fn().mockReturnValue(false),
      retrieve: jest.fn().mockResolvedValue([]),
    };

    const service = new HybridRetrieverService(
      runtime as never,
      configService as never,
      elasticsearchService as never,
      chunkRepo as never,
      graphRetriever as never,
    );

    return {
      service,
      configService,
      elasticsearchService,
      elasticsearchClient,
      chunkRepo,
      queryBuilder,
      rpcMock,
      graphRetriever,
    };
  }

  it('按 stage1 rank 融合 hybrid 与 graph，不让 graph 原始分数覆盖 hybrid 排序', async () => {
    const vectorChunk: KnowledgeChunk = {
      id: 'chunk-hybrid',
      content: '向量关键词命中的条款。',
      source: 'contract.md',
      chunk_index: 1,
      category: 'contract',
      similarity: 0.91,
      retrieval_sources: ['vector'],
    };
    const keywordChunk = {
      id: 'chunk-hybrid',
      content: '向量关键词命中的条款。',
      source: 'contract.md',
      chunk_index: 1,
      category: 'contract',
      similarity: 0,
      keyword_score: 12,
      retrieval_sources: ['keyword'],
    };
    const graphChunk: KnowledgeChunk = {
      id: 'chunk-graph',
      content: '图谱关系命中的条款。',
      source: 'contract.md',
      chunk_index: 2,
      category: 'contract',
      similarity: 0,
      graph_score: 99,
      retrieval_sources: ['graph'],
    };

    const { service, graphRetriever } = createService({
      vectorResult: [
        {
          id: vectorChunk.id,
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          content: vectorChunk.content,
          source: vectorChunk.source,
          chunk_index: vectorChunk.chunk_index,
          category: vectorChunk.category,
          similarity: vectorChunk.similarity,
        },
      ],
      pgResult: [
        {
          id: keywordChunk.id,
          content: keywordChunk.content,
          source: keywordChunk.source,
          chunk_index: keywordChunk.chunk_index,
          category: keywordChunk.category,
          similarity: 0,
          knowledge_base_id: 'kb-1',
          keyword_score: keywordChunk.keyword_score,
        },
      ],
    });

    graphRetriever.isEnabled.mockReturnValue(true);
    graphRetriever.retrieve.mockResolvedValue([graphChunk]);

    const result = await service.retrieveForKnowledge({
      knowledgeId: 'kb-1',
      retrievalQueries: [
        {
          index: 0,
          query: '验收付款关系',
          keywords: ['验收', '付款'],
          angle: 'original',
        },
      ],
      strategy,
      threshold: 0.6,
      globalRetrievalLimit: 10,
    });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual([
      'chunk-hybrid',
      'chunk-graph',
    ]);
    expect(result.chunks[0]?.hybrid_score).toBeGreaterThan(0);
    expect(result.trace[0]).toMatchObject({
      knowledgeId: 'kb-1',
      vectorBackend: 'pgvector',
      keywordBackend: 'pg',
      graphBackend: 'neo4j',
      graphResultCount: 1,
    });
  });

  it('配置为 elastic 且 ES 可用时优先走 ES', async () => {
    const { service, queryBuilder, elasticsearchClient } = createService({
      backend: 'elastic',
      elasticsearchEnabled: true,
    });

    const result = await service.retrieveForKnowledge({
      knowledgeId: 'kb-1',
      retrievalQueries: [
        {
          index: 0,
          query: '删除时限 试用数据',
          keywords: ['删除时限', '试用数据'],
          angle: 'original',
        },
      ],
      strategy: {
        ...strategy,
        useVector: false,
        useGraph: false,
        useKeyword: true,
      },
      threshold: 0.6,
      globalRetrievalLimit: 5,
    });

    expect(elasticsearchClient.search).toHaveBeenCalled();
    expect(queryBuilder.getRawMany).not.toHaveBeenCalled();
    expect(result.trace[0].keywordBackend).toBe('elastic');
    expect(result.trace[0].fallbackToPg).toBe(false);
  });

  it('配置为 elastic 但 ES 未启用时会直接回退 PG', async () => {
    const { service, queryBuilder, elasticsearchClient } = createService({
      backend: 'elastic',
      elasticsearchEnabled: false,
    });

    const result = await service.retrieveForKnowledge({
      knowledgeId: 'kb-1',
      retrievalQueries: [
        {
          index: 0,
          query: '删除时限',
          keywords: ['删除时限'],
          angle: 'original',
        },
      ],
      strategy: {
        ...strategy,
        useVector: false,
        useGraph: false,
        useKeyword: true,
      },
      threshold: 0.6,
      globalRetrievalLimit: 5,
    });

    expect(elasticsearchClient.search).not.toHaveBeenCalled();
    expect(queryBuilder.getRawMany).toHaveBeenCalled();
    expect(result.trace[0].keywordBackend).toBe('pg');
    expect(result.trace[0].fallbackToPg).toBe(true);
  });

  it('ES 检索抛错时会自动回退 PG', async () => {
    const { service, queryBuilder, elasticsearchClient } = createService({
      backend: 'elastic',
      elasticsearchEnabled: true,
      elasticError: new Error('es unavailable'),
    });

    const result = await service.retrieveForKnowledge({
      knowledgeId: 'kb-1',
      retrievalQueries: [
        {
          index: 0,
          query: '删除时限',
          keywords: ['删除时限'],
          angle: 'original',
        },
      ],
      strategy: {
        ...strategy,
        useVector: false,
        useGraph: false,
        useKeyword: true,
      },
      threshold: 0.6,
      globalRetrievalLimit: 5,
    });

    expect(elasticsearchClient.search).toHaveBeenCalled();
    expect(queryBuilder.getRawMany).toHaveBeenCalled();
    expect(result.trace[0].keywordBackend).toBe('pg');
    expect(result.trace[0].fallbackToPg).toBe(true);
  });
});
