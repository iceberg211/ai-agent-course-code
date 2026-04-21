import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';

describe('KnowledgeHybridRetrieverService', () => {
  it('会把向量检索和关键词检索的结果做融合排序', async () => {
    const vectorRetriever = {
      retrieve: jest.fn().mockResolvedValue([
        {
          id: 'a',
          content: '向量命中的 chunk A',
          source: 'a.md',
          chunk_index: 0,
          category: null,
          similarity: 0.93,
          retrieval_sources: ['vector'],
        },
        {
          id: 'b',
          content: '向量命中的 chunk B',
          source: 'b.md',
          chunk_index: 1,
          category: null,
          similarity: 0.84,
          retrieval_sources: ['vector'],
        },
      ]),
    };

    const keywordRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        backend: 'elastic',
        fallbackToPg: false,
        chunks: [
          {
            id: 'b',
            content: '关键词命中的 chunk B',
            source: 'b.md',
            chunk_index: 1,
            category: null,
            similarity: 0,
            keyword_score: 18,
            retrieval_sources: ['keyword'],
          },
          {
            id: 'c',
            content: '关键词命中的 chunk C',
            source: 'c.md',
            chunk_index: 2,
            category: null,
            similarity: 0,
            keyword_score: 12,
            retrieval_sources: ['keyword'],
          },
        ],
      }),
    };

    const service = new KnowledgeHybridRetrieverService(
      vectorRetriever as never,
      keywordRetriever as never,
    );

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      retrievalQuery: '雁门关事件主谋',
      keywordTerms: ['雁门关事件', '主谋'],
      threshold: 0.6,
      matchCount: 5,
    });

    expect(result.chunks.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(result.chunks[0].retrieval_sources).toEqual(['vector', 'keyword']);
    expect(result.chunks[0].hybrid_score).toBeGreaterThan(
      result.chunks[1].hybrid_score ?? 0,
    );
    expect(result.keywordBackend).toBe('elastic');
    expect(result.vectorResultCount).toBe(2);
    expect(result.keywordResultCount).toBe(2);
  });
});
