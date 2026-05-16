import { KnowledgeDocumentIndexSyncService } from '@/knowledge-content/services/knowledge-document-index-sync.service';

describe('KnowledgeDocumentIndexSyncService', () => {
  it('Neo4j 未启用时只同步 ES，不执行图谱抽取', async () => {
    const elasticsearchSyncService = {
      safeBulkUpsertChunkDocuments: jest.fn(),
      safeDeleteByDocumentId: jest.fn(),
    };
    const graphExtractorService = {
      extract: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const neo4jGraphSyncService = {
      isEnabled: jest.fn().mockReturnValue(false),
      safeDeleteByDocumentId: jest.fn(),
      safeUpsertDocument: jest.fn().mockResolvedValue({ status: 'indexed' }),
      safeUpdateChunkEnabled: jest.fn(),
    };
    const knowledgeChunkIndexQueryService = {
      findByChunkId: jest.fn(),
    };
    const service = new KnowledgeDocumentIndexSyncService(
      elasticsearchSyncService as never,
      graphExtractorService as never,
      neo4jGraphSyncService as never,
      knowledgeChunkIndexQueryService as never,
    );

    const result = await service.syncCreatedDocument({
      documentId: 'doc-1',
      knowledgeId: 'kb-1',
      source: 'demo.md',
      rows: [
        {
          id: 'chunk-1',
          document_id: 'doc-1',
          chunk_index: 0,
          content: '甲方应在验收后付款。',
          source: 'demo.md',
          category: null,
          enabled: true,
          embedding: '[0.1]',
        },
      ],
    });

    expect(result).toEqual({ status: 'skipped' });
    expect(
      elasticsearchSyncService.safeBulkUpsertChunkDocuments,
    ).toHaveBeenCalledTimes(1);
    expect(graphExtractorService.extract).not.toHaveBeenCalled();
    expect(neo4jGraphSyncService.safeUpsertDocument).not.toHaveBeenCalled();
  });
});
