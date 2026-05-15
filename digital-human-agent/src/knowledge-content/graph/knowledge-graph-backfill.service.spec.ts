import { KnowledgeGraphBackfillService } from '@/knowledge-content/graph/knowledge-graph-backfill.service';

describe('KnowledgeGraphBackfillService', () => {
  it('按 chunk 页发现文档，并按文档完整 chunk 回填图谱索引', async () => {
    const knowledgeChunkIndexQueryService = {
      listPage: jest
        .fn()
        .mockResolvedValueOnce({
          items: [
            {
              id: 'chunk-1',
              document_id: 'doc-1',
              knowledge_base_id: 'kb-1',
              chunk_index: 0,
              content: '第一段',
              source: 'a.md',
              category: null,
              enabled: true,
            },
            {
              id: 'chunk-2',
              document_id: 'doc-1',
              knowledge_base_id: 'kb-1',
              chunk_index: 1,
              content: '第二段',
              source: 'a.md',
              category: null,
              enabled: true,
            },
          ],
          nextCursor: {
            createdAt: '2026-05-15T12:00:00.000Z',
            id: 'chunk-2',
          },
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'chunk-3',
              document_id: 'doc-2',
              knowledge_base_id: 'kb-1',
              chunk_index: 0,
              content: '第三段',
              source: 'b.md',
              category: 'faq',
              enabled: true,
            },
          ],
          nextCursor: null,
        }),
      listByDocumentId: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'chunk-1',
            document_id: 'doc-1',
            knowledge_base_id: 'kb-1',
            chunk_index: 0,
            content: '第一段',
            source: 'a.md',
            category: null,
            enabled: true,
          },
          {
            id: 'chunk-2',
            document_id: 'doc-1',
            knowledge_base_id: 'kb-1',
            chunk_index: 1,
            content: '第二段',
            source: 'a.md',
            category: null,
            enabled: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'chunk-3',
            document_id: 'doc-2',
            knowledge_base_id: 'kb-1',
            chunk_index: 0,
            content: '第三段',
            source: 'b.md',
            category: 'faq',
            enabled: true,
          },
        ]),
    };
    const graphSyncService = {
      markStaleByVersion: jest.fn().mockResolvedValue(4),
      bulkUpsertGraph: jest.fn().mockResolvedValue({ nodeCount: 2, edgeCount: 1 }),
      markFailed: jest.fn(),
    };
    const graphExtractorService = {
      extract: jest
        .fn()
        .mockResolvedValueOnce({
          nodes: [{ type: 'Topic', name: '第一段' }],
          edges: [],
        })
        .mockResolvedValueOnce({
          nodes: [{ type: 'Topic', name: '第三段' }],
          edges: [],
        }),
    };
    const service = new KnowledgeGraphBackfillService(
      knowledgeChunkIndexQueryService as never,
      graphSyncService as never,
      graphExtractorService as never,
    );

    const summary = await service.backfillAll(2);

    expect(graphSyncService.markStaleByVersion).toHaveBeenCalledWith({
      extractorVersion: 'graph-extractor-v1',
      schemaVersion: 'graph-schema-v1',
    });
    expect(knowledgeChunkIndexQueryService.listPage).toHaveBeenNthCalledWith(
      1,
      2,
      undefined,
    );
    expect(knowledgeChunkIndexQueryService.listPage).toHaveBeenNthCalledWith(
      2,
      2,
      {
        createdAt: '2026-05-15T12:00:00.000Z',
        id: 'chunk-2',
      },
    );
    expect(knowledgeChunkIndexQueryService.listByDocumentId).toHaveBeenCalledWith(
      'doc-1',
    );
    expect(knowledgeChunkIndexQueryService.listByDocumentId).toHaveBeenCalledWith(
      'doc-2',
    );
    expect(graphExtractorService.extract).toHaveBeenNthCalledWith(1, {
      documentId: 'doc-1',
      chunks: [
        { id: 'chunk-1', chunkIndex: 0, source: 'a.md', content: '第一段' },
        { id: 'chunk-2', chunkIndex: 1, source: 'a.md', content: '第二段' },
      ],
    });
    expect(graphExtractorService.extract).toHaveBeenNthCalledWith(2, {
      documentId: 'doc-2',
      chunks: [
        { id: 'chunk-3', chunkIndex: 0, source: 'b.md', content: '第三段' },
      ],
    });
    expect(graphSyncService.bulkUpsertGraph).toHaveBeenNthCalledWith(1, {
      documentId: 'doc-1',
      chunks: [
        { id: 'chunk-1', chunkIndex: 0, source: 'a.md', content: '第一段' },
        { id: 'chunk-2', chunkIndex: 1, source: 'a.md', content: '第二段' },
      ],
      extractedGraph: {
        nodes: [{ type: 'Topic', name: '第一段' }],
        edges: [],
      },
      extractorVersion: 'graph-extractor-v1',
      schemaVersion: 'graph-schema-v1',
    });
    expect(graphSyncService.bulkUpsertGraph).toHaveBeenNthCalledWith(2, {
      documentId: 'doc-2',
      chunks: [
        { id: 'chunk-3', chunkIndex: 0, source: 'b.md', content: '第三段' },
      ],
      extractedGraph: {
        nodes: [{ type: 'Topic', name: '第三段' }],
        edges: [],
      },
      extractorVersion: 'graph-extractor-v1',
      schemaVersion: 'graph-schema-v1',
    });
    expect(summary).toEqual({
      pageCount: 2,
      documentCount: 2,
      chunkCount: 3,
      staleDocumentCount: 4,
    });
  });

  it('抽取失败时记录 failed 状态并停止回填', async () => {
    const error = new Error('extract failed');
    const knowledgeChunkIndexQueryService = {
      listPage: jest.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'chunk-1',
            document_id: 'doc-1',
            knowledge_base_id: 'kb-1',
            chunk_index: 0,
            content: '正文',
            source: 'a.md',
            category: null,
            enabled: true,
          },
        ],
        nextCursor: null,
      }),
      listByDocumentId: jest.fn().mockResolvedValueOnce([
        {
          id: 'chunk-1',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          chunk_index: 0,
          content: '正文',
          source: 'a.md',
          category: null,
          enabled: true,
        },
      ]),
    };
    const graphSyncService = {
      markStaleByVersion: jest.fn().mockResolvedValue(0),
      bulkUpsertGraph: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const graphExtractorService = {
      extract: jest.fn().mockRejectedValue(error),
    };
    const service = new KnowledgeGraphBackfillService(
      knowledgeChunkIndexQueryService as never,
      graphSyncService as never,
      graphExtractorService as never,
    );

    await expect(service.backfillAll(10)).rejects.toThrow('extract failed');

    expect(graphSyncService.markFailed).toHaveBeenCalledWith({
      documentId: 'doc-1',
      extractorVersion: 'graph-extractor-v1',
      schemaVersion: 'graph-schema-v1',
      error,
    });
    expect(graphSyncService.bulkUpsertGraph).not.toHaveBeenCalled();
  });
});
