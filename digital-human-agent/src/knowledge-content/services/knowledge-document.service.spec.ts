import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';

describe('KnowledgeDocumentService', () => {
  function createService() {
    const document = {
      id: 'doc-1',
      knowledgeBaseId: 'kb-1',
      filename: 'demo.md',
      status: 'processing',
      chunkCount: 0,
      mimeType: null,
      fileSize: null,
    };
    const documentRepo = {
      create: jest.fn((input) => ({
        ...document,
        ...input,
      })),
      save: jest.fn(async (input) => input),
      update: jest.fn(),
      findOneByOrFail: jest.fn(),
      delete: jest.fn(),
      find: jest.fn(),
    };
    const chunkRepo = {
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const insert = jest.fn().mockResolvedValue({
      error: {
        message: 'insert failed',
      },
    });
    const runtime = {
      splitter: {
        createDocuments: jest.fn().mockResolvedValue([
          {
            pageContent: '第一段内容',
          },
        ]),
      },
      embeddings: {
        model: 'text-embedding-v4',
        embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      },
      embeddingBatchSize: 10,
      withTransientRetry: jest.fn(async (_operation, fn) => fn()),
      supabase: {
        from: jest.fn(() => ({
          insert,
        })),
      },
    };
    const elasticsearchSyncService = {
      safeBulkUpsertChunkDocuments: jest.fn(),
      safeDeleteByDocumentId: jest.fn(),
    };
    const knowledgeChunkIndexQueryService = {
      findByChunkId: jest.fn(),
    };

    const service = new KnowledgeDocumentService(
      documentRepo as never,
      chunkRepo as never,
      runtime as never,
      elasticsearchSyncService as never,
      knowledgeChunkIndexQueryService as never,
    );

    return {
      service,
      documentRepo,
      chunkRepo,
      elasticsearchSyncService,
    };
  }

  it('导入失败时会清理当前文档的 chunk 和 ES 派生索引，并把文档标记为 failed', async () => {
    const { service, documentRepo, chunkRepo, elasticsearchSyncService } =
      createService();

    await expect(
      service.ingestDocument('kb-1', 'demo.md', '第一段内容'),
    ).rejects.toThrow('insert failed');

    expect(chunkRepo.delete).toHaveBeenCalledWith({ documentId: 'doc-1' });
    expect(
      elasticsearchSyncService.safeDeleteByDocumentId,
    ).toHaveBeenCalledWith('doc-1', '导入失败清理文档 doc-1');
    expect(documentRepo.update).toHaveBeenCalledWith('doc-1', {
      status: 'failed',
      chunkCount: 0,
    });
  });
});
