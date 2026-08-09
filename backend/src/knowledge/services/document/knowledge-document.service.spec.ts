import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('KnowledgeDocumentService', () => {
  type MockDocument = {
    id: string;
    knowledgeBaseId: string;
    filename: string;
    status: string;
    chunkCount: number;
    mimeType: string | null;
    fileSize: number | null;
    processingStage?: string;
    processingError?: string | null;
  };

  type DocumentUpdate = Partial<{
    status: string;
    chunkCount: number;
    processingStage: string;
    processingError: string | null;
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
      processingStage: 'uploaded',
      processingError: null,
    };
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[document], 1]),
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
      findOne: jest.fn(() =>
        Promise.resolve({
          ...document,
          status: 'completed',
          isCurrentVersion: true,
          archivedAt: null,
        }),
      ),
      delete: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const chunkRepo = {
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          chunkIndex: 0,
          source: 'demo.md',
          category: null,
          content: '# 服务协议\n\n总览说明。',
        },
        {
          id: 'chunk-2',
          chunkIndex: 1,
          source: 'demo.md',
          category: null,
          content: '# 服务协议\n## 试用数据\n\n试用期结束后，乙方应在七日内删除甲方试用数据。',
        },
      ]),
    };
    const assetRepo = {
      find: jest.fn().mockResolvedValue([]),
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
        embedDocuments: jest.fn().mockImplementation((texts: string[]) =>
          Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
        ),
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
    const elasticsearchService = {
      safeBulkUpsertChunkDocuments: jest.fn(),
      safeDeleteByDocumentId: jest.fn(),
      findByChunkId: jest.fn(),
    };
    const graphService = {
      isEnabled: jest.fn().mockReturnValue(true),
      extract: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
      safeUpsertDocument: jest
        .fn<Promise<GraphSyncResult>, [GraphUpsertInput]>()
        .mockResolvedValue({ status: 'indexed' }),
      safeDeleteByDocumentId: jest.fn(),
      safeUpdateChunkEnabled: jest.fn(),
    };

    const service = new KnowledgeDocumentService(
      documentRepo as never,
      chunkRepo as never,
      assetRepo as never,
      runtime as never,
      elasticsearchService as never,
      graphService as never,
    );

    return {
      service,
      documentRepo,
      chunkRepo,
      assetRepo,
      runtime,
      insert,
      update,
      updateEq,
      elasticsearchService,
      graphService,
      queryBuilder,
    };
  }

  it('导入失败时会清理当前文档的 chunk、ES 与 Neo4j 图谱索引，并把文档标记为 failed', async () => {
    const {
      service,
      documentRepo,
      chunkRepo,
      elasticsearchService,
      graphService,
    } = createService({ insertError: 'insert failed' });

    await expect(
      service.ingestDocument('kb-1', 'demo.md', '第一段内容'),
    ).rejects.toThrow('insert failed');

    expect(chunkRepo.delete).toHaveBeenCalledWith({ documentId: 'doc-1' });
    expect(elasticsearchService.safeDeleteByDocumentId).toHaveBeenCalledWith(
      'doc-1',
      '导入失败清理文档 doc-1',
    );
    expect(graphService.safeDeleteByDocumentId).toHaveBeenCalledWith(
      'doc-1',
      '导入失败清理文档 doc-1',
    );
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        status: 'failed',
        chunkCount: 0,
        processingStage: 'failed',
      }),
    );
  });

  it('删除文档时会同步清理 ES 与 Neo4j 图谱索引', async () => {
    const { service, documentRepo, elasticsearchService, graphService } =
      createService();

    await service.deleteDocument('doc-1');

    expect(documentRepo.delete).toHaveBeenCalledWith('doc-1');
    expect(elasticsearchService.safeDeleteByDocumentId).toHaveBeenCalledWith(
      'doc-1',
      '删除文档 doc-1',
    );
    expect(graphService.safeDeleteByDocumentId).toHaveBeenCalledWith(
      'doc-1',
      '删除文档 doc-1',
    );
  });

  it('更新 chunk 启停状态时会同步 ES 与 Neo4j 图谱索引', async () => {
    const { service, update, updateEq, elasticsearchService, graphService } =
      createService();
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
    elasticsearchService.findByChunkId.mockResolvedValue(chunkDocument);

    await service.updateChunkEnabled('chunk-1', false);

    expect(update).toHaveBeenCalledWith({ enabled: false });
    expect(updateEq).toHaveBeenCalledWith('id', 'chunk-1');
    expect(
      elasticsearchService.safeBulkUpsertChunkDocuments,
    ).toHaveBeenCalledWith([chunkDocument], '更新 chunk chunk-1');
    expect(graphService.safeUpdateChunkEnabled).toHaveBeenCalledWith(
      'chunk-1',
      false,
      '更新 chunk chunk-1',
    );
  });

  it('Markdown 导入时会按标题边界生成 structure chunk 再写入索引', async () => {
    const {
      service,
      documentRepo,
      runtime,
      insert,
      elasticsearchService,
      graphService,
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
    await flushPromises();

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
      elasticsearchService.safeBulkUpsertChunkDocuments,
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
    const graphUpsertCall = graphService.safeUpsertDocument.mock
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

  it('向量化会按 embeddingBatchSize 分批执行并逐批写入索引', async () => {
    const { service, runtime, insert, elasticsearchService } = createService();
    runtime.embeddingBatchSize = 1;

    await service.ingestDocument(
      'kb-1',
      'demo.md',
      ['# 第一节', '', '第一段。', '', '# 第二节', '', '第二段。'].join(
        '\n',
      ),
    );

    expect(runtime.embeddings.embedDocuments).toHaveBeenNthCalledWith(1, [
      '# 第一节\n\n第一段。',
    ]);
    expect(runtime.embeddings.embedDocuments).toHaveBeenNthCalledWith(2, [
      '# 第二节\n\n第二段。',
    ]);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(
      elasticsearchService.safeBulkUpsertChunkDocuments,
    ).toHaveBeenCalledTimes(2);
  });

  it('Neo4j 图谱写入失败时主文档仍完成，但会记录图谱同步失败状态', async () => {
    const { service, documentRepo, graphService } = createService();
    graphService.safeUpsertDocument.mockResolvedValue({
      status: 'failed',
      errorMessage: 'neo4j unavailable',
    });

    await service.ingestDocument('kb-1', 'demo.md', '普通文本内容');
    await flushPromises();

    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        status: 'completed',
        chunkCount: 1,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      }),
    );
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        graphSyncStatus: 'failed',
        graphSyncError: 'neo4j unavailable',
        graphSyncedAt: null,
      }),
    );
  });

  it('图谱抽取失败时主文档仍完成，并记录图谱同步失败状态', async () => {
    const { service, documentRepo, graphService } = createService();
    graphService.extract.mockRejectedValue(new Error('extract failed'));

    await service.ingestDocument('kb-1', 'demo.md', '普通文本内容');
    await flushPromises();

    expect(graphService.safeUpsertDocument).not.toHaveBeenCalled();
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        status: 'completed',
        chunkCount: 1,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      }),
    );
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        graphSyncStatus: 'failed',
        graphSyncError: 'extract failed',
        graphSyncedAt: null,
      }),
    );
  });

  it('Neo4j 未启用时不会执行图谱抽取，并记录 skipped 状态', async () => {
    const { service, documentRepo, graphService } = createService();
    graphService.isEnabled.mockReturnValue(false);

    await service.ingestDocument('kb-1', 'demo.md', '普通文本内容');
    await flushPromises();

    expect(graphService.extract).not.toHaveBeenCalled();
    expect(graphService.safeUpsertDocument).not.toHaveBeenCalled();
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        status: 'completed',
        chunkCount: 1,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      }),
    );
    expect(documentRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        graphSyncStatus: 'skipped',
        graphSyncError: null,
        graphSyncedAt: null,
      }),
    );
  });

  it('listDocumentsForKnowledge 会支持由 DTO 传递的 processingStage 筛选参数', async () => {
    const { service, queryBuilder } = createService();

    await service.listDocumentsForKnowledge('kb-1', {
      processingStage: 'embedding',
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'document.processing_stage = :processingStage',
      { processingStage: 'embedding' },
    );
  });

  it('batchRetryDocuments 会返回每个文档的重试结果', async () => {
    const { service } = createService();
    const spy = jest
      .spyOn(service, 'retryDocumentForKnowledge')
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error('retry failed'));

    const result = await service.batchRetryDocuments('kb-1', [
      'doc-1',
      'doc-2',
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'kb-1', 'doc-1', undefined);
    expect(spy).toHaveBeenNthCalledWith(2, 'kb-1', 'doc-2', undefined);
    expect(result).toEqual([
      { documentId: 'doc-1', success: true },
      { documentId: 'doc-2', success: false, error: 'retry failed' },
    ]);
  });
});
