import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type { RetrievalStrategy } from '@/common/rag';

const sampleChunk: KnowledgeChunk = {
  id: 'chunk-keyword',
  content: '合同中关于删除时限的条款',
  source: 'contract.md',
  chunk_index: 0,
  category: 'legal',
  similarity: 0,
  keyword_score: 12,
  retrieval_sources: ['keyword'],
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
    pgResult?: KnowledgeChunk[];
    elasticError?: Error;
    vectorResult?: KnowledgeChunk[];
  }) {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'HYBRID_KEYWORD_BACKEND') {
          return options?.backend ?? 'pg';
        }
        return undefined;
      }),
    };

    const runtime = {
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      embeddings: {
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      },
      supabase: {
        rpc: jest.fn().mockReturnValue({
          abortSignal: jest.fn().mockResolvedValue({
            data: (options?.vectorResult ?? []).map((chunk) => ({
              ...chunk,
              retrieval_sources: ['vector'],
            })),
            error: null,
          }),
        }),
      },
      toBoundedNumber: jest.fn((value: any, defaultValue: number) => defaultValue),
    };

    const fulltextRetriever = {
      retrieve: jest.fn().mockImplementation(() => {
        if (options?.backend === 'elastic' && (options?.elasticsearchEnabled ?? false)) {
          if (options?.elasticError) {
            return Promise.resolve({
              chunks: options?.pgResult ?? [sampleChunk],
              backend: 'pg' as const,
              fallbackToPg: true,
            });
          }
          return Promise.resolve({
            chunks: [sampleChunk],
            backend: 'elastic' as const,
            fallbackToPg: false,
          });
        }
        return Promise.resolve({
          chunks: options?.pgResult ?? [sampleChunk],
          backend: 'pg' as const,
          fallbackToPg:
            options?.backend === 'elastic' && !(options?.elasticsearchEnabled ?? false),
        });
      }),
    };

    const graphRetriever = {
      isEnabled: jest.fn().mockReturnValue(false),
      retrieve: jest.fn().mockResolvedValue([]),
    };

    const service = new HybridRetrieverService(
      runtime as never,
      configService as never,
      fulltextRetriever as never,
      graphRetriever as never,
    );

    return {
      service,
      configService,
      runtime,
      fulltextRetriever,
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
    const keywordChunk: KnowledgeChunk = {
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

    const { service, graphRetriever, runtime } = createService({
      vectorResult: [vectorChunk],
      pgResult: [keywordChunk],
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
    const { service, fulltextRetriever } = createService({
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

    expect(fulltextRetriever.retrieve).toHaveBeenCalled();
    expect(result.trace[0].keywordBackend).toBe('elastic');
    expect(result.trace[0].fallbackToPg).toBe(false);
  });

  it('配置为 elastic 但 ES 未启用时会直接回退 PG', async () => {
    const { service, fulltextRetriever } = createService({
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

    expect(fulltextRetriever.retrieve).toHaveBeenCalled();
    expect(result.trace[0].keywordBackend).toBe('pg');
    expect(result.trace[0].fallbackToPg).toBe(true);
  });

  it('ES 检索抛错时会自动回退 PG', async () => {
    const { service, fulltextRetriever } = createService({
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

    expect(fulltextRetriever.retrieve).toHaveBeenCalled();
    expect(result.trace[0].keywordBackend).toBe('pg');
    expect(result.trace[0].fallbackToPg).toBe(true);
  });
});
