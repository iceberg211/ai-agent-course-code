import { buildRagElasticOnlyQuery } from '@/knowledge-content/evaluation/rag-elastic-only-query';

describe('buildRagElasticOnlyQuery', () => {
  it('ES-only 评估查询包含短语、字段精确加权和 ngram 兜底', () => {
    const query = buildRagElasticOnlyQuery('mock-legal-service-agreement.md');

    expect(query.bool.should).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          match_phrase: expect.objectContaining({
            content: expect.objectContaining({
              query: 'mock-legal-service-agreement.md',
              boost: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          term: expect.objectContaining({
            'source.keyword': expect.objectContaining({
              value: 'mock-legal-service-agreement.md',
              boost: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          term: expect.objectContaining({
            'category.keyword': expect.objectContaining({
              value: 'mock-legal-service-agreement.md',
              boost: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          match: expect.objectContaining({
            'content.ngram': expect.objectContaining({
              query: 'mock-legal-service-agreement.md',
              boost: expect.any(Number),
            }),
          }),
        }),
      ]),
    );
    expect(query.bool.minimum_should_match).toBe(1);
  });
});
