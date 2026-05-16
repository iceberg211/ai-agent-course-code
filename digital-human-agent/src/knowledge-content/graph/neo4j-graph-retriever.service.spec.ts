import { Neo4jGraphRetrieverService } from '@/knowledge-content/graph/neo4j-graph-retriever.service';

describe('Neo4jGraphRetrieverService', () => {
  it('未启用 Neo4j 时直接返回空结果', async () => {
    const graphService = {
      isEnabled: jest.fn().mockReturnValue(false),
      query: jest.fn(),
    };
    const service = new Neo4jGraphRetrieverService(graphService as never);

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      retrievalQuery: '甲方 乙方',
      keywordTerms: ['甲方'],
      matchCount: 5,
    });

    expect(result).toEqual([]);
    expect(graphService.query).not.toHaveBeenCalled();
  });

  it('从 Neo4j KnowledgeChunk 和 GraphNode 关系返回图谱证据', async () => {
    const graphService = {
      isEnabled: jest.fn().mockReturnValue(true),
      query: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          content: '甲方应向乙方支付服务费。',
          source: 'contract.md',
          chunk_index: 2,
          category: 'contract',
          graph_score: 1.2,
          graph_evidence: [
            {
              source: '甲方',
              target: '乙方',
              relationType: 'MENTIONS',
              relationLabel: '提及',
              evidenceText: '甲方应向乙方支付服务费。',
              confidence: 0.8,
            },
          ],
        },
      ]),
    };
    const service = new Neo4jGraphRetrieverService(graphService as never);

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      retrievalQuery: '甲方 乙方',
      keywordTerms: ['甲方', '乙方'],
      matchCount: 5,
    });

    expect(graphService.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})',
      ),
      expect.objectContaining({
        knowledgeId: 'kb-1',
        terms: ['甲方', '乙方', '甲方 乙方'],
        matchCount: 5,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'chunk-1',
        retrieval_sources: ['graph'],
        graph_score: 1.2,
        graph_evidence: [
          expect.objectContaining({
            source: '甲方',
            target: '乙方',
            relationType: 'MENTIONS',
          }),
        ],
      }),
    ]);
  });

  it('path 模式会按 graphMaxHops 构造多跳路径查询', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, Record<string, unknown>]>()
      .mockResolvedValue([]);
    const graphService = {
      isEnabled: jest.fn().mockReturnValue(true),
      query,
    };
    const service = new Neo4jGraphRetrieverService(graphService as never);

    await service.retrieve({
      knowledgeId: 'kb-1',
      retrievalQuery: '甲方 验收 付款',
      keywordTerms: ['甲方', '付款'],
      matchCount: 5,
      graphMode: 'path',
      graphMaxHops: 2,
    });

    expect(graphService.query).toHaveBeenCalledWith(
      expect.stringContaining('MATCH path ='),
      expect.objectContaining({
        knowledgeId: 'kb-1',
        matchCount: 5,
      }),
    );
    expect(query.mock.calls[0]?.[0]).toContain('*1..2');
  });
});
