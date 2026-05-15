import { KnowledgeParentChildBackfillService } from '@/knowledge-content/parent-child/knowledge-parent-child-backfill.service';

describe('KnowledgeParentChildBackfillService', () => {
  it('按文档分页回填 Parent-Child 派生索引', async () => {
    const queryService = {
      listPage: jest.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'chunk-0',
            document_id: 'doc-1',
            knowledge_base_id: 'kb-1',
            chunk_index: 0,
            content: '第一段',
            source: 'guide.md',
            category: 'faq',
            enabled: true,
          },
          {
            id: 'chunk-1',
            document_id: 'doc-1',
            knowledge_base_id: 'kb-1',
            chunk_index: 1,
            content: '第二段',
            source: 'guide.md',
            category: 'faq',
            enabled: true,
          },
        ],
        nextCursor: null,
      }),
      listByDocumentId: jest.fn().mockResolvedValue([
        {
          id: 'chunk-0',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          chunk_index: 0,
          content: '第一段',
          source: 'guide.md',
          category: 'faq',
          enabled: true,
        },
        {
          id: 'chunk-1',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          chunk_index: 1,
          content: '第二段',
          source: 'guide.md',
          category: 'faq',
          enabled: true,
        },
      ]),
    };
    const syncService = {
      markStaleByVersion: jest.fn().mockResolvedValue(1),
      bulkUpsertParentChunks: jest.fn().mockResolvedValue({
        parentCount: 1,
        childCount: 2,
      }),
    };
    const service = new KnowledgeParentChildBackfillService(
      queryService as never,
      syncService as never,
    );

    const summary = await service.backfillAll(50, {
      indexVersion: 'parent-child-v2',
      maxParentChars: 1200,
      maxChildChunks: 3,
    });

    expect(syncService.markStaleByVersion).toHaveBeenCalledWith({
      indexVersion: 'parent-child-v2',
    });
    expect(queryService.listPage).toHaveBeenCalledWith(50, undefined);
    expect(queryService.listByDocumentId).toHaveBeenCalledWith('doc-1');
    expect(syncService.bulkUpsertParentChunks).toHaveBeenCalledWith({
      documentId: 'doc-1',
      indexVersion: 'parent-child-v2',
      maxParentChars: 1200,
      maxChildChunks: 3,
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
    expect(summary).toEqual({
      pageCount: 1,
      documentCount: 1,
      chunkCount: 2,
      parentCount: 1,
      staleDocumentCount: 1,
    });
  });
});
