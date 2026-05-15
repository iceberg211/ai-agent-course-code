import { KnowledgeParentChildSyncService } from '@/knowledge-content/parent-child/knowledge-parent-child-sync.service';

describe('KnowledgeParentChildSyncService', () => {
  function createService() {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO rag_parent_chunk')) {
          return [{ id: `parent-${manager.query.mock.calls.length}` }];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      query: jest.fn(),
    };
    const service = new KnowledgeParentChildSyncService(dataSource as never);

    return {
      dataSource,
      manager,
      service,
    };
  }

  it('按 document 幂等重建 parent chunk、child 映射和索引状态', async () => {
    const { dataSource, manager, service } = createService();

    const summary = await service.bulkUpsertParentChunks({
      documentId: 'doc-1',
      indexVersion: 'parent-child-v1',
      maxParentChars: 2000,
      maxChildChunks: 5,
      chunks: [
        {
          id: 'chunk-0',
          chunkIndex: 0,
          source: 'guide.md',
          category: 'faq',
          content: '第一段',
        },
        {
          id: 'chunk-1',
          chunkIndex: 1,
          source: 'guide.md',
          category: 'faq',
          content: '第二段',
        },
      ],
    });

    const sql = manager.query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(sql).toContain('INSERT INTO rag_parent_chunk_index_status');
    expect(sql).toContain('DELETE FROM rag_parent_chunk_child');
    expect(sql).toContain('DELETE FROM rag_parent_chunk');
    expect(sql).toContain('INSERT INTO rag_parent_chunk');
    expect(sql).toContain('INSERT INTO rag_parent_chunk_child');
    expect(summary).toEqual({
      parentCount: 1,
      childCount: 2,
    });
  });

  it('能按 indexVersion 标记过期索引', async () => {
    const { dataSource, service } = createService();
    dataSource.query.mockResolvedValue([{ document_id: 'doc-old' }]);

    await expect(
      service.markStaleByVersion({ indexVersion: 'parent-child-v2' }),
    ).resolves.toBe(1);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rag_parent_chunk_index_status'),
      ['parent-child-v2'],
    );
  });
});
