import { Neo4jGraphBackfillService } from '@/knowledge-content/graph/neo4j-graph-backfill.service';

describe('Neo4jGraphBackfillService', () => {
  it('回填 Neo4j 图谱后会写回文档图谱同步状态', async () => {
    type GraphSyncStatusUpdate = {
      graphSyncStatus: string;
      graphSyncError: string | null;
      graphSyncedAt: Date | null;
    };
    const update = jest.fn<Promise<void>, [string, GraphSyncStatusUpdate]>();
    const documentRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'doc-1', status: 'completed' }])
        .mockResolvedValueOnce([]),
      update,
    };
    const chunkIndexQueryService = {
      listByDocumentId: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          knowledge_base_id: 'kb-1',
          chunk_index: 0,
          source: 'contract.md',
          category: 'contract',
          content: '甲方应在验收后付款。',
        },
      ]),
    };
    const graphExtractorService = {
      extract: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const neo4jGraphSyncService = {
      isEnabled: jest.fn().mockReturnValue(true),
      safeUpsertDocument: jest.fn().mockResolvedValue({ status: 'indexed' }),
    };
    const service = new Neo4jGraphBackfillService(
      documentRepo as never,
      chunkIndexQueryService as never,
      graphExtractorService as never,
      neo4jGraphSyncService as never,
    );

    const summary = await service.backfillAll(25);

    expect(summary).toEqual({
      pageCount: 1,
      documentCount: 1,
      chunkCount: 1,
      failedDocumentCount: 0,
    });
    expect(neo4jGraphSyncService.safeUpsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        knowledgeId: 'kb-1',
      }),
    );
    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0];
    expect(updateCall?.[0]).toBe('doc-1');
    expect(updateCall?.[1]).toMatchObject({
      graphSyncStatus: 'indexed',
      graphSyncError: null,
    });
    expect(updateCall?.[1].graphSyncedAt).toBeInstanceOf(Date);
  });

  it('Neo4j 未启用时回填不会执行图谱抽取，并写回 skipped 状态', async () => {
    type GraphSyncStatusUpdate = {
      graphSyncStatus: string;
      graphSyncError: string | null;
      graphSyncedAt: Date | null;
    };
    const update = jest.fn<Promise<void>, [string, GraphSyncStatusUpdate]>();
    const documentRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'doc-1', status: 'completed' }])
        .mockResolvedValueOnce([]),
      update,
    };
    const chunkIndexQueryService = {
      listByDocumentId: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          knowledge_base_id: 'kb-1',
          chunk_index: 0,
          source: 'contract.md',
          category: 'contract',
          content: '甲方应在验收后付款。',
        },
      ]),
    };
    const graphExtractorService = {
      extract: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const neo4jGraphSyncService = {
      isEnabled: jest.fn().mockReturnValue(false),
      safeUpsertDocument: jest.fn().mockResolvedValue({ status: 'indexed' }),
    };
    const service = new Neo4jGraphBackfillService(
      documentRepo as never,
      chunkIndexQueryService as never,
      graphExtractorService as never,
      neo4jGraphSyncService as never,
    );

    const summary = await service.backfillAll(25);

    expect(summary).toEqual({
      pageCount: 1,
      documentCount: 1,
      chunkCount: 1,
      failedDocumentCount: 0,
    });
    expect(graphExtractorService.extract).not.toHaveBeenCalled();
    expect(neo4jGraphSyncService.safeUpsertDocument).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('doc-1', {
      graphSyncStatus: 'skipped',
      graphSyncError: null,
      graphSyncedAt: null,
    });
  });
});
