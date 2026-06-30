import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';

function createQueryBuilderMock(rows: Array<{ id: string }>) {
  return {
    select: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('KnowledgeGraphService', () => {
  function createService() {
    const neo4jGraphService = {
      isEnabled: jest.fn().mockReturnValue(true),
      query: jest.fn().mockResolvedValue([]),
    };
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    };
    const documentRepo = {
      find: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const chunkRepo = {
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
    };
    const service = new KnowledgeGraphService(
      neo4jGraphService as any,
      configService as any,
      documentRepo as any,
      chunkRepo as any,
    );
    return { service, neo4jGraphService, documentRepo, chunkRepo };
  }

  it('listEntities 只把当前可见 chunk 传给 Neo4j 查询', async () => {
    const { service, neo4jGraphService, chunkRepo } = createService();
    const qb = createQueryBuilderMock([{ id: 'chunk-1' }]);
    chunkRepo.createQueryBuilder.mockReturnValue(qb);

    await service.listEntities(
      'kb-1',
      '乔峰',
      10,
      { ownerId: 'user-1', department: '研发部', role: 'user' },
    );

    expect(qb.where).toHaveBeenCalledWith(
      'document.knowledge_base_id = :knowledgeId',
      { knowledgeId: 'kb-1' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('document.archived_at IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('document.is_current_version = true');
    expect(qb.andWhere).toHaveBeenCalledWith('chunk.enabled = true');
    expect(neo4jGraphService.query).toHaveBeenCalledWith(
      expect.stringContaining('c.id IN $chunkIds'),
      expect.objectContaining({
        knowledgeId: 'kb-1',
        query: '乔峰',
        limit: 10,
        chunkIds: ['chunk-1'],
      }),
    );
  });

  it('rebuildGraph 只重建当前版本，并统计单文档同步失败', async () => {
    const { service, documentRepo, chunkRepo } = createService();
    documentRepo.find.mockResolvedValue([
      {
        id: 'doc-1',
        filename: 'demo.md',
        isCurrentVersion: true,
        archivedAt: null,
      },
    ]);
    chunkRepo.find.mockResolvedValue([
      {
        id: 'chunk-1',
        source: 'demo.md',
        chunkIndex: 0,
        content: '乔峰是契丹人。',
        category: 'text',
        allowedUserIds: ['user-1'],
        allowedRoleIds: null,
        allowedDepartmentIds: ['研发部'],
        securityLevel: 1,
        aclVersion: 2,
      },
    ]);
    jest.spyOn(service, 'safeDeleteByDocumentId').mockResolvedValue(undefined);
    jest.spyOn(service, 'extract').mockResolvedValue({ nodes: [], edges: [] });
    jest.spyOn(service, 'safeUpsertDocument').mockResolvedValue({
      status: 'failed',
      errorMessage: 'neo4j unavailable',
    });

    const result = await service.rebuildGraph('kb-1');

    expect(documentRepo.find).toHaveBeenCalledWith({
      where: {
        knowledgeBaseId: 'kb-1',
        archivedAt: expect.any(Object),
        isCurrentVersion: true,
      },
    });
    expect(result).toEqual({
      success: false,
      documentCount: 1,
      indexedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      errors: [{ documentId: 'doc-1', message: 'neo4j unavailable' }],
    });
    expect(documentRepo.update).toHaveBeenCalledWith('doc-1', {
      graphSyncStatus: 'failed',
      graphSyncError: 'neo4j unavailable',
      graphSyncedAt: null,
    });
  });
});
