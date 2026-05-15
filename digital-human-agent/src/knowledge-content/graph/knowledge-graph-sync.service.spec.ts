import { KnowledgeGraphSyncService } from '@/knowledge-content/graph/knowledge-graph-sync.service';

describe('KnowledgeGraphSyncService', () => {
  function createService() {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO rag_graph_node')) {
        return [{ id: `node-${query.mock.calls.length}` }];
      }
      return [];
    });
    const manager = { query };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      query: jest.fn(),
    };
    const service = new KnowledgeGraphSyncService(dataSource as never);
    return { service, dataSource, query };
  }

  it('按 pending -> indexed 状态幂等写入节点和关系', async () => {
    const { service, dataSource, query } = createService();

    const summary = await service.bulkUpsertGraph({
      documentId: 'doc-1',
      chunks: [
        {
          id: 'chunk-1',
          chunkIndex: 0,
          source: 'contract.md',
          content: '甲方负责审计保留。',
        },
      ],
      extractedGraph: {
        nodes: [
          { type: 'Entity', name: '甲方', entityType: 'Party' },
          { type: 'Topic', name: '审计保留' },
        ],
        edges: [
          {
            source: { type: 'Entity', name: '甲方', entityType: 'Party' },
            target: { type: 'Topic', name: '审计保留' },
            relationType: 'RELATED_TO',
            chunkId: 'chunk-1',
          },
        ],
      },
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ nodeCount: 4, edgeCount: 2 });
    expect(query.mock.calls[0][0]).toContain(
      'INSERT INTO rag_graph_index_status',
    );
    expect(query.mock.calls[0][1]).toEqual([
      'doc-1',
      'pending',
      'graph-extractor-v1',
      'graph-schema-v1',
      0,
      0,
      null,
    ]);
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO rag_graph_node'),
      ),
    ).toHaveLength(4);
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO rag_graph_edge'),
      ),
    ).toHaveLength(2);
    expect(query.mock.calls.at(-1)?.[0]).toContain(
      'INSERT INTO rag_graph_index_status',
    );
    expect(query.mock.calls.at(-1)?.[1]).toEqual([
      'doc-1',
      'indexed',
      'graph-extractor-v1',
      'graph-schema-v1',
      4,
      2,
      null,
    ]);
  });

  it('写入失败时记录 failed 状态并继续抛出错误', async () => {
    const query = jest.fn();
    const error = new Error('graph unavailable');
    const dataSource = {
      transaction: jest.fn().mockRejectedValue(error),
      query,
    };
    const service = new KnowledgeGraphSyncService(dataSource as never);

    await expect(
      service.bulkUpsertGraph({
        documentId: 'doc-1',
        chunks: [],
        extractedGraph: { nodes: [], edges: [] },
      }),
    ).rejects.toThrow('graph unavailable');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO rag_graph_index_status'),
      expect.arrayContaining(['doc-1', 'failed']),
    );
  });

  it('支持在抽取阶段失败时单独记录 failed 状态', async () => {
    const query = jest.fn();
    const dataSource = {
      transaction: jest.fn(),
      query,
    };
    const service = new KnowledgeGraphSyncService(dataSource as never);

    await service.markFailed({
      documentId: 'doc-1',
      extractorVersion: 'graph-extractor-v2',
      schemaVersion: 'graph-schema-v2',
      error: new Error('extract failed'),
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO rag_graph_index_status'),
      [
        'doc-1',
        'failed',
        'graph-extractor-v2',
        'graph-schema-v2',
        'extract failed',
      ],
    );
  });

  it('删除文档时按派生数据顺序清理关系、节点和状态', async () => {
    const { service, dataSource, query } = createService();

    await service.deleteByDocumentId('doc-1');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map(([sql]) => compactSql(String(sql)))).toEqual([
      'DELETE FROM rag_graph_edge WHERE document_id = $1',
      'DELETE FROM rag_graph_node WHERE document_id = $1',
      'DELETE FROM rag_graph_index_status WHERE document_id = $1',
    ]);
  });

  it('版本变化时把旧 indexed 文档标记为 stale', async () => {
    const { service, dataSource } = createService();
    dataSource.query.mockResolvedValue([
      { document_id: 'doc-1' },
      { document_id: 'doc-2' },
      { document_id: 'doc-3' },
    ]);

    const staleCount = await service.markStaleByVersion({
      extractorVersion: 'graph-extractor-v2',
      schemaVersion: 'graph-schema-v2',
    });

    expect(staleCount).toBe(3);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'stale'"),
      ['graph-extractor-v2', 'graph-schema-v2'],
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('RETURNING document_id'),
      ['graph-extractor-v2', 'graph-schema-v2'],
    );
  });

  it('状态行使用当前图谱抽取器和 schema 版本', async () => {
    const { service, query } = createService();

    await service.bulkUpsertGraph({
      documentId: 'doc-1',
      chunks: [],
      extractedGraph: { nodes: [], edges: [] },
      extractorVersion: 'graph-extractor-v2',
      schemaVersion: 'graph-schema-v2',
    });

    const statusCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO rag_graph_index_status'),
    );
    expect(statusCalls).toHaveLength(2);
    expect(statusCalls.map(([, params]) => params)).toEqual([
      ['doc-1', 'pending', 'graph-extractor-v2', 'graph-schema-v2', 0, 0, null],
      ['doc-1', 'indexed', 'graph-extractor-v2', 'graph-schema-v2', 1, 0, null],
    ]);
  });
});

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
