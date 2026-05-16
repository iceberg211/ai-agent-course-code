import { Neo4jGraphSyncService } from '@/knowledge-content/graph/neo4j-graph-sync.service';

describe('Neo4jGraphSyncService', () => {
  it('safeUpsertDocument 写入失败时会清理当前文档的半写入图谱', async () => {
    const graphService = {
      isEnabled: jest.fn().mockReturnValue(true),
      query: jest.fn((cypher: string) => {
        if (cypher.includes('MERGE (d:KnowledgeDocument')) {
          throw new Error('partial write failed');
        }
        return Promise.resolve([]);
      }),
    };
    const service = new Neo4jGraphSyncService(graphService as never);

    const result = await service.safeUpsertDocument({
      documentId: 'doc-1',
      knowledgeId: 'kb-1',
      source: 'contract.md',
      chunks: [
        {
          id: 'chunk-1',
          chunkIndex: 0,
          source: 'contract.md',
          category: 'contract',
          content: '甲方应在验收后付款。',
        },
      ],
      extractedGraph: { nodes: [], edges: [] },
    });

    const relationDeleteCalls = graphService.query.mock.calls.filter(
      ([cypher]) => String(cypher).includes('MATCH ()-[r]-()'),
    );

    expect(result).toEqual({
      status: 'failed',
      errorMessage: 'partial write failed',
    });
    expect(relationDeleteCalls).toHaveLength(2);
  });
});
