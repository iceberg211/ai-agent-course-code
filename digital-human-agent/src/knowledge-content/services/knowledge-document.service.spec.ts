import { KnowledgeDocumentIndexSyncService } from '@/knowledge-content/services/knowledge-document-index-sync.service';
import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';

describe('KnowledgeDocumentService', () => {
  type MockDocument = {
    id: string;
    knowledgeBaseId: string;
    filename: string;
    status: string;
    chunkCount: number;
    mimeType: string | null;
    fileSize: number | null;
  };

  type DocumentUpdate = Partial<{
    status: string;
    chunkCount: number;
    graphSyncStatus: string;
    graphSyncError: string | null;
    graphSyncedAt: Date | null;
  }>;

  type GraphUpsertInput = {
    documentId: string;
    knowledgeId: string;
    source: string;
    chunks: Array<{ content: string; chunkIndex: number }>;
  };

  type GraphSyncResult = {
    status: 'indexed' | 'failed' | 'skipped';
    errorMessage?: string;
  };

  function createService(
    options: {
      insertError?: string | null;
    } = {},
  ) {
    const document: MockDocument = {
      id: 'doc-1',
      knowledgeBaseId: 'kb-1',
      filename: 'demo.md',
      status: 'processing',
      chunkCount: 0,
      mimeType: null,
      fileSize: null,
    };
    const documentRepo = {
      create: jest.fn(
        (input: Partial<MockDocument>): MockDocument => ({
          ...document,
          ...input,
        }),
      ),
      save: jest.fn((input: MockDocument) => Promise.resolve(input)),
      update: jest.fn<Promise<void>, [string, DocumentUpdate]>(),
      findOneByOrFail: jest.fn(() =>
        Promise.resolve({
          ...document,
          status: 'completed',
        }),
      ),
      delete: jest.fn(),
      find: jest.fn(),
    };
    const chunkRepo = {
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const insert = jest.fn().mockResolvedValue({
      error: options.insertError
        ? {
            message: options.insertError,
          }
        : null,
    });
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({
      eq: updateEq,
    }));
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
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      supabase: {
        from: jest.fn(() => ({
          insert,
          update,
        })),
      },
    };
    const elasticsearchSyncService = {
      safeBulkUpsertChunkDocuments: jest.fn(),
      safeDeleteByDocumentId: jest.fn(),
    };
    const graphExtractorService = {
      extract: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const neo4jGraphSyncService = {
      isEnabled: jest.fn().mockReturnValue(true),
      safeDeleteByDocumentId: jest.fn(),
      safeUpsertDocument: jest
        .fn<Promise<GraphSyncResult>, [GraphUpsertInput]>()
        .mockResolvedValue({ status: 'indexed' }),
      safeUpdateChunkEnabled: jest.fn(),
    };
    const knowledgeChunkIndexQueryService = {
      findByChunkId: jest.fn(),
    };
    const documentIndexSyncService = new KnowledgeDocumentIndexSyncService(
      elasticsearchSyncService as never,
      graphExtractorService as never,
      neo4jGraphSyncService as never,
      knowledgeChunkIndexQueryService as never,
    );

    const service = new KnowledgeDocumentService(
      documentRepo as never,
      chunkRepo as never,
      runtime as never,
      documentIndexSyncService,
    );

    return {
      service,
      documentRepo,
      chunkRepo,
      runtime,
      insert,
      update,
      updateEq,
      documentIndexSyncService,
      elasticsearchSyncService,
      graphExtractorService,
      neo4jGraphSyncService,
      knowledgeChunkIndexQueryService,
    };
  }

  it('导入失败时会清理当前文档的 chunk、ES 与 Neo4j 图谱索引，并把文档标记为 failed', async () => {
    const {
      service,
      documentRepo,
      chunkRepo,
      elasticsearchSyncService,
      neo4jGraphSyncService,
    } = createService({ insertError: 'insert failed' });

    await expect(
      service.ingestDocument('kb-1', 'demo.md', '第一段内容'),
    ).rejects.toThrow('insert failed');

    expect(chunkRepo.delete).toHaveBeenCalledWith({ documentId: 'doc-1' });
    expect(
      elasticsearchSyncService.safeDeleteByDocumentId,
    ).toHaveBeenCalledWith('doc-1', '导入失败清理文档 doc-1');
    expect(neo4jGraphSyncService.safeDeleteByDocumentId).toHaveBeenCalledWith(
      'doc-1',
      '导入失败清理文档 doc-1',
    );
    expect(documentRepo.update).toHaveBeenCalledWith('doc-1', {
      status: 'failed',
      chunkCount: 0,
    });
  });

  it('删除文档时会同步清理 ES 与 Neo4j 图谱索引', async () => {
    const {
      service,
      documentRepo,
      elasticsearchSyncService,
      neo4jGraphSyncService,
    } = createService();

    await service.deleteDocument('doc-1');

    expect(documentRepo.delete).toHaveBeenCalledWith('doc-1');
    expect(
      elasticsearchSyncService.safeDeleteByDocumentId,
    ).toHaveBeenCalledWith('doc-1', '删除文档 doc-1');
    expect(neo4jGraphSyncService.safeDeleteByDocumentId).toHaveBeenCalledWith(
      'doc-1',
      '删除文档 doc-1',
    );
  });

  it('更新 chunk 启停状态时会同步 ES 与 Neo4j 图谱索引', async () => {
    const {
      service,
      update,
      updateEq,
      elasticsearchSyncService,
      neo4jGraphSyncService,
      knowledgeChunkIndexQueryService,
    } = createService();
    const chunkDocument = {
      id: 'chunk-1',
      document_id: 'doc-1',
      knowledge_base_id: 'kb-1',
      chunk_index: 0,
      content: '已禁用内容',
      source: 'demo.md',
      category: null,
      enabled: false,
    };
    knowledgeChunkIndexQueryService.findByChunkId.mockResolvedValue(
      chunkDocument,
    );

    await service.updateChunkEnabled('chunk-1', false);

    expect(update).toHaveBeenCalledWith({ enabled: false });
    expect(updateEq).toHaveBeenCalledWith('id', 'chunk-1');
    expect(
      elasticsearchSyncService.safeBulkUpsertChunkDocuments,
    ).toHaveBeenCalledWith([chunkDocument], '更新 chunk chunk-1');
    expect(neo4jGraphSyncService.safeUpdateChunkEnabled).toHaveBeenCalledWith(
      'chunk-1',
      false,
      '更新 chunk chunk-1',
    );
  });

  it('Markdown 导入时会按标题边界生成结构化 chunk 再写入索引', async () => {
    const {
      service,
      documentRepo,
      runtime,
      insert,
      elasticsearchSyncService,
      neo4jGraphSyncService,
    } = createService();

    await service.ingestDocument(
      'kb-1',
      'demo.md',
      [
        '# 服务协议',
        '',
        '总览说明。',
        '',
        '## 试用数据',
        '',
        '试用期结束后，乙方应在七日内删除甲方试用数据。',
      ].join('\n'),
    );

    expect(runtime.splitter.createDocuments).not.toHaveBeenCalled();
    expect(runtime.embeddings.embedDocuments).toHaveBeenCalledWith([
      '# 服务协议\n\n总览说明。',
      '# 服务协议\n## 试用数据\n\n试用期结束后，乙方应在七日内删除甲方试用数据。',
    ]);
    expect(insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: '# 服务协议\n\n总览说明。',
          chunk_index: 0,
        }),
        expect.objectContaining({
          content:
            '# 服务协议\n## 试用数据\n\n试用期结束后，乙方应在七日内删除甲方试用数据。',
          chunk_index: 1,
        }),
      ]),
    );
    expect(
      elasticsearchSyncService.safeBulkUpsertChunkDocuments,
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: '# 服务协议\n\n总览说明。',
          chunk_index: 0,
        }),
        expect.objectContaining({
          content:
            '# 服务协议\n## 试用数据\n\n试用期结束后，乙方应在七日内删除甲方试用数据。',
          chunk_index: 1,
        }),
      ]),
      '写入文档 doc-1',
    );
    const graphUpsertCall = neo4jGraphSyncService.safeUpsertDocument.mock
      .calls[0]?.[0] as
      | {
          documentId: string;
          knowledgeId: string;
          source: string;
          chunks: Array<{ content: string; chunkIndex: number }>;
        }
      | undefined;
    expect(graphUpsertCall).toMatchObject({
      documentId: 'doc-1',
      knowledgeId: 'kb-1',
      source: 'demo.md',
    });
    expect(
      graphUpsertCall?.chunks.some(
        (chunk) =>
          chunk.content === '# 服务协议\n\n总览说明。' &&
          chunk.chunkIndex === 0,
      ),
    ).toBe(true);
    const completedUpdate = documentRepo.update.mock.calls.find(
      ([documentId, payload]) =>
        documentId === 'doc-1' && payload.status === 'completed',
    )?.[1];
    expect(completedUpdate).toMatchObject({
      status: 'completed',
      chunkCount: 2,
      graphSyncStatus: 'pending',
      graphSyncError: null,
    });
    expect(completedUpdate?.graphSyncedAt).toBeNull();
    const graphIndexedUpdate = documentRepo.update.mock.calls.find(
      ([documentId, payload]) =>
        documentId === 'doc-1' && payload.graphSyncStatus === 'indexed',
    )?.[1];
    expect(graphIndexedUpdate).toMatchObject({
      graphSyncStatus: 'indexed',
      graphSyncError: null,
    });
    expect(graphIndexedUpdate?.graphSyncedAt).toBeInstanceOf(Date);
  });

  it('Neo4j 图谱写入失败时主文档仍完成，但会记录图谱同步失败状态', async () => {
    const { service, documentRepo, neo4jGraphSyncService } = createService();
    neo4jGraphSyncService.safeUpsertDocument.mockResolvedValue({
      status: 'failed',
      errorMessage: 'neo4j unavailable',
    });

    await service.ingestDocument('kb-1', 'demo.md', '普通文本内容');

    expect(documentRepo.update).toHaveBeenCalledWith('doc-1', {
      status: 'completed',
      chunkCount: 1,
      graphSyncStatus: 'pending',
      graphSyncError: null,
      graphSyncedAt: null,
    });
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      {
        graphSyncStatus: 'failed',
        graphSyncError: 'neo4j unavailable',
        graphSyncedAt: null,
      },
    );
  });

  it('图谱抽取失败时主文档仍完成，并记录图谱同步失败状态', async () => {
    const {
      service,
      documentRepo,
      graphExtractorService,
      neo4jGraphSyncService,
    } = createService();
    graphExtractorService.extract.mockRejectedValue(
      new Error('extract failed'),
    );

    await service.ingestDocument('kb-1', 'demo.md', '普通文本内容');

    expect(neo4jGraphSyncService.safeUpsertDocument).not.toHaveBeenCalled();
    expect(documentRepo.update).toHaveBeenCalledWith('doc-1', {
      status: 'completed',
      chunkCount: 1,
      graphSyncStatus: 'pending',
      graphSyncError: null,
      graphSyncedAt: null,
    });
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      {
        graphSyncStatus: 'failed',
        graphSyncError: 'extract failed',
        graphSyncedAt: null,
      },
    );
  });

  it('Neo4j 未启用时不会执行图谱抽取，并记录 skipped 状态', async () => {
    const {
      service,
      documentRepo,
      graphExtractorService,
      neo4jGraphSyncService,
    } = createService();
    neo4jGraphSyncService.isEnabled.mockReturnValue(false);

    await service.ingestDocument('kb-1', 'demo.md', '普通文本内容');

    expect(graphExtractorService.extract).not.toHaveBeenCalled();
    expect(neo4jGraphSyncService.safeUpsertDocument).not.toHaveBeenCalled();
    expect(documentRepo.update).toHaveBeenCalledWith('doc-1', {
      status: 'completed',
      chunkCount: 1,
      graphSyncStatus: 'pending',
      graphSyncError: null,
      graphSyncedAt: null,
    });
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      {
        graphSyncStatus: 'skipped',
        graphSyncError: null,
        graphSyncedAt: null,
      },
    );
  });
});
