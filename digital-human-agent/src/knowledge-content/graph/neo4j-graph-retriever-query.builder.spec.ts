import {
  buildNeo4jGraphRetrieveQuery,
  buildNeo4jGraphSearchTerms,
} from '@/knowledge-content/graph/neo4j-graph-retriever-query.builder';

describe('neo4j graph retriever query builder', () => {
  it('path 模式会限制最大跳数并归一搜索词', () => {
    const query = buildNeo4jGraphRetrieveQuery('path', 2);
    const terms = buildNeo4jGraphSearchTerms(
      ['  甲方   付款  ', '甲方 付款'],
      '验收',
    );

    expect(query).toContain('MATCH path =');
    expect(query).toContain('*1..2');
    expect(terms).toEqual(['甲方 付款', '验收']);
  });
});
