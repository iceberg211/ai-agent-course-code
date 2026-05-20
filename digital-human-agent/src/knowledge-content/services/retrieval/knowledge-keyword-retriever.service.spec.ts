import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/retrieval/knowledge-keyword-retriever.service';

const sampleChunk = {
  id: 'chunk-1',
  content: '合同中关于删除时限的条款',
  source: 'contract.md',
  chunk_index: 0,
  category: 'legal',
  similarity: 0,
  keyword_score: 12,
  retrieval_sources: ['keyword'] as const,
};

describe('KnowledgeKeywordRetrieverService', () => {
  function createService(options?: {
    backend?: string;
    elasticsearchEnabled?: boolean;
    elasticResult?: unknown;
    pgResult?: unknown[];
    elasticError?: Error;
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

    const service = new KnowledgeKeywordRetrieverService(
      configService as never,
      elasticsearchService as never,
      chunkRepo as never,
    );

    return {
      service,
      configService,
      elasticsearchService,
      elasticsearchClient,
      chunkRepo,
      queryBuilder,
    };
  }

  it('配置为 elastic 且 ES 可用时优先走 ES', async () => {
    const { service, queryBuilder, elasticsearchClient } =
      createService({
        backend: 'elastic',
        elasticsearchEnabled: true,
      });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['删除时限', '试用数据'],
      matchCount: 5,
    });

    expect(elasticsearchClient.search).toHaveBeenCalled();
    expect(queryBuilder.getRawMany).not.toHaveBeenCalled();
    expect(result.backend).toBe('elastic');
    expect(result.fallbackToPg).toBe(false);
  });

  it('配置为 elastic 但 ES 未启用时会直接回退 PG', async () => {
    const { service, queryBuilder, elasticsearchClient } =
      createService({
        backend: 'elastic',
        elasticsearchEnabled: false,
      });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['删除时限'],
      matchCount: 5,
    });

    expect(elasticsearchClient.search).not.toHaveBeenCalled();
    expect(queryBuilder.getRawMany).toHaveBeenCalled();
    expect(result.backend).toBe('pg');
    expect(result.fallbackToPg).toBe(true);
  });

  it('ES 检索抛错时会自动回退 PG', async () => {
    const { service, queryBuilder, elasticsearchClient } =
      createService({
        backend: 'elastic',
        elasticsearchEnabled: true,
        elasticError: new Error('es unavailable'),
      });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['删除时限'],
      matchCount: 5,
    });

    expect(elasticsearchClient.search).toHaveBeenCalled();
    expect(queryBuilder.getRawMany).toHaveBeenCalled();
    expect(result.backend).toBe('pg');
    expect(result.fallbackToPg).toBe(true);
  });

  it('ES 回退 PG 时保留 useExactPhrase 参数', async () => {
    const { service, queryBuilder, elasticsearchClient } =
      createService({
        backend: 'elastic',
        elasticsearchEnabled: true,
        elasticError: new Error('es unavailable'),
      });
    const params = {
      knowledgeId: 'kb-1',
      terms: ['删除时限'],
      matchCount: 5,
      useExactPhrase: true,
      signal: new AbortController().signal,
    };

    await service.retrieve(params);

    expect(elasticsearchClient.search).toHaveBeenCalled();
    expect(queryBuilder.where).toHaveBeenCalled();
  });
});
