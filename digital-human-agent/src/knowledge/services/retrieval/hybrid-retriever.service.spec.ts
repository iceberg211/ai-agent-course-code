import { HybridRetrieverService } from '@/knowledge/services/retrieval/hybrid-retriever.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type { RetrievalStrategy } from '@/common/rag';

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

    const rpcMock = jest.fn().mockResolvedValue({
      data: [
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

    const keywordRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        chunks: [keywordChunk],
        backend: 'pg',
        fallbackToPg: false,
      }),
    };

    const graphRetriever = {
      isEnabled: jest.fn().mockReturnValue(true),
      retrieve: jest.fn().mockResolvedValue([graphChunk]),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const service = new HybridRetrieverService(
      runtime as never,
      keywordRetriever as never,
      mockConfigService as never,
      graphRetriever as never,
    );

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
});
