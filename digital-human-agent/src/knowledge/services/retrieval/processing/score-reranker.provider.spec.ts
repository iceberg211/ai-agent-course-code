import { ScoreRerankerProvider } from '@/knowledge/services/retrieval/processing/score-reranker.provider';

describe('ScoreRerankerProvider', () => {
  it('按 hybrid/similarity 排序截断', async () => {
    const provider = new ScoreRerankerProvider();
    const result = await provider.rerank({
      query: 'q',
      candidates: [
        {
          id: 'low',
          content: 'a',
          source: 's',
          chunk_index: 0,
          category: null,
          similarity: 0.2,
        },
        {
          id: 'high',
          content: 'b',
          source: 's',
          chunk_index: 1,
          category: null,
          similarity: 0.9,
          hybrid_score: 0.05,
        },
      ],
      topK: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('high');
    expect(result[0].rerank_score).toBeGreaterThan(0);
  });
});
