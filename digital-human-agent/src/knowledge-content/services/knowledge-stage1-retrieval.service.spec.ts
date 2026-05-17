import { KnowledgeStage1RetrievalService } from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import type { RetrievalStrategy } from '@/common/rag';

describe('KnowledgeStage1RetrievalService', () => {
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
    const hybridChunk: KnowledgeChunk = {
      id: 'chunk-hybrid',
      content: '向量关键词命中的条款。',
      source: 'contract.md',
      chunk_index: 1,
      category: 'contract',
      similarity: 0.91,
      hybrid_score: 0.032,
      retrieval_sources: ['vector', 'keyword'],
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
    const runtime = {
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      embeddings: {
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      },
    };
    const hybridRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        chunks: [hybridChunk],
        keywordBackend: 'pg',
        vectorResultCount: 1,
        keywordResultCount: 1,
        fallbackToPg: false,
        skippedChannels: [],
      }),
    };
    const graphRetriever = {
      isEnabled: jest.fn().mockReturnValue(true),
      retrieve: jest.fn().mockResolvedValue([graphChunk]),
    };
    const service = new KnowledgeStage1RetrievalService(
      runtime as never,
      hybridRetriever as never,
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
      globalStage1TopK: 10,
    });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual([
      'chunk-hybrid',
      'chunk-graph',
    ]);
    expect(result.chunks[1]?.hybrid_score).toBeLessThan(0.032);
    expect(result.trace[0]).toMatchObject({
      knowledgeId: 'kb-1',
      vectorBackend: 'pgvector',
      keywordBackend: 'pg',
      graphBackend: 'neo4j',
      graphResultCount: 1,
    });
  });
});
