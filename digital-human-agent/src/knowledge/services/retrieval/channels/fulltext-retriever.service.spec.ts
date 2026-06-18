import { FulltextRetrieverService } from './fulltext-retriever.service';

const sampleChunk = {
  id: 'chunk-1',
  content: 'test content',
  source: 'test.md',
  chunk_index: 0,
  category: 'test',
  similarity: 0,
  keyword_score: 10,
  retrieval_sources: ['keyword'] as const,
};

describe('FulltextRetrieverService', () => {
  function createService(options?: {
    backend?: string;
    elasticsearchEnabled?: boolean;
    elasticResult?: any;
    existingChunks?: any[];
    pgResult?: any[];
  }) {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'HYBRID_KEYWORD_BACKEND') {
          return options?.backend ?? 'pg';
        }
        return undefined;
      }),
    };

    const elasticsearchClient = {
      search: jest.fn().mockResolvedValue(
        options?.elasticResult ?? {
          hits: {
            hits: [
              {
                _id: 'chunk-1',
                _source: {
                  id: 'chunk-1',
                  content: 'test content',
                  source: 'test.md',
                  chunk_index: 0,
                  category: 'test',
                  knowledge_base_id: 'kb-1',
                },
                _score: 10,
              },
            ],
          },
        },
      ),
    };

    const elasticsearchIndexService = {
      isEnabled: jest
        .fn()
        .mockReturnValue(options?.elasticsearchEnabled ?? false),
      getClient: jest.fn().mockReturnValue(elasticsearchClient),
      ensureKnowledgeChunkIndex: jest.fn().mockResolvedValue(undefined),
      getKnowledgeChunkReadAlias: jest.fn().mockReturnValue('alias-read'),
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
      getRawMany: jest
        .fn()
        .mockResolvedValue(options?.pgResult ?? [sampleChunk]),
    };

    const chunkRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      find: jest.fn().mockResolvedValue(
        options?.existingChunks ?? [
          {
            id: 'chunk-1',
            documentId: 'doc-1',
            content: 'test content',
            source: 'test.md',
            chunkIndex: 0,
            category: 'test',
          },
        ],
      ),
    };

    const service = new FulltextRetrieverService(
      configService as any,
      elasticsearchIndexService as any,
      chunkRepo as any,
    );

    return {
      service,
      elasticsearchClient,
      queryBuilder,
    };
  }

  it('ES 启用时调用 ES 进行检索', async () => {
    const { service, elasticsearchClient } = createService({
      backend: 'elastic',
      elasticsearchEnabled: true,
    });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['test'],
      matchCount: 5,
    });

    expect(elasticsearchClient.search).toHaveBeenCalled();
    expect(result.backend).toBe('elastic');
    expect(result.chunks[0].id).toBe('chunk-1');
  });

  it('ES 未启用时调用 PG 进行检索', async () => {
    const { service, queryBuilder } = createService({
      backend: 'pg',
      elasticsearchEnabled: false,
    });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['test'],
      matchCount: 5,
    });

    expect(queryBuilder.getRawMany).toHaveBeenCalled();
    expect(result.backend).toBe('pg');
    expect(result.chunks[0].id).toBe('chunk-1');
  });
});
