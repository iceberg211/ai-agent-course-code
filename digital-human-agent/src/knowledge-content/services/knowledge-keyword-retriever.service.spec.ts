import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/knowledge-keyword-retriever.service';

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
    elasticResult?: unknown[];
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

    const elasticsearchIndexService = {
      isEnabled: jest
        .fn()
        .mockReturnValue(options?.elasticsearchEnabled ?? false),
    };

    const pgKeywordRetriever = {
      retrieveChunks: jest
        .fn()
        .mockResolvedValue(options?.pgResult ?? [sampleChunk]),
    };

    const elasticKeywordRetriever = {
      retrieveChunks: options?.elasticError
        ? jest.fn().mockRejectedValue(options.elasticError)
        : jest.fn().mockResolvedValue(options?.elasticResult ?? [sampleChunk]),
    };

    const service = new KnowledgeKeywordRetrieverService(
      configService as never,
      elasticsearchIndexService as never,
      pgKeywordRetriever as never,
      elasticKeywordRetriever as never,
    );

    return {
      service,
      configService,
      elasticsearchIndexService,
      pgKeywordRetriever,
      elasticKeywordRetriever,
    };
  }

  it('配置为 elastic 且 ES 可用时优先走 ES', async () => {
    const { service, pgKeywordRetriever, elasticKeywordRetriever } =
      createService({
        backend: 'elastic',
        elasticsearchEnabled: true,
      });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['删除时限', '试用数据'],
      matchCount: 5,
    });

    expect(elasticKeywordRetriever.retrieveChunks).toHaveBeenCalled();
    expect(pgKeywordRetriever.retrieveChunks).not.toHaveBeenCalled();
    expect(result.backend).toBe('elastic');
    expect(result.fallbackToPg).toBe(false);
  });

  it('配置为 elastic 但 ES 未启用时会直接回退 PG', async () => {
    const { service, pgKeywordRetriever, elasticKeywordRetriever } =
      createService({
        backend: 'elastic',
        elasticsearchEnabled: false,
      });

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      terms: ['删除时限'],
      matchCount: 5,
    });

    expect(elasticKeywordRetriever.retrieveChunks).not.toHaveBeenCalled();
    expect(pgKeywordRetriever.retrieveChunks).toHaveBeenCalled();
    expect(result.backend).toBe('pg');
    expect(result.fallbackToPg).toBe(true);
  });

  it('ES 检索抛错时会自动回退 PG', async () => {
    const { service, pgKeywordRetriever, elasticKeywordRetriever } =
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

    expect(elasticKeywordRetriever.retrieveChunks).toHaveBeenCalled();
    expect(pgKeywordRetriever.retrieveChunks).toHaveBeenCalled();
    expect(result.backend).toBe('pg');
    expect(result.fallbackToPg).toBe(true);
  });
});
