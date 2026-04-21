import { KnowledgeElasticsearchBackfillService } from '@/knowledge-content/backfill/knowledge-elasticsearch-backfill.service';

describe('KnowledgeElasticsearchBackfillService', () => {
  it('会按页回填并返回统计结果', async () => {
    const elasticsearchIndexService = {
      isEnabled: jest.fn().mockReturnValue(true),
      ensureKnowledgeChunkIndex: jest.fn().mockResolvedValue(undefined),
    };
    const elasticsearchSyncService = {
      bulkUpsertChunkDocuments: jest.fn().mockResolvedValue(undefined),
    };
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
              content: '第一页第一条',
              source: 'a.md',
              category: null,
              enabled: true,
            },
          ],
          nextCursor: {
            createdAt: '2026-04-21T12:00:00.000Z',
            id: 'chunk-1',
          },
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'chunk-2',
              document_id: 'doc-2',
              knowledge_base_id: 'kb-1',
              chunk_index: 1,
              content: '第二页第一条',
              source: 'b.md',
              category: 'faq',
              enabled: true,
            },
          ],
          nextCursor: null,
        }),
    };

    const service = new KnowledgeElasticsearchBackfillService(
      elasticsearchIndexService as never,
      elasticsearchSyncService as never,
      knowledgeChunkIndexQueryService as never,
    );

    const result = await service.backfillAll(1);

    expect(
      elasticsearchIndexService.ensureKnowledgeChunkIndex,
    ).toHaveBeenCalled();
    expect(knowledgeChunkIndexQueryService.listPage).toHaveBeenNthCalledWith(
      1,
      1,
      undefined,
    );
    expect(knowledgeChunkIndexQueryService.listPage).toHaveBeenNthCalledWith(
      2,
      1,
      {
        createdAt: '2026-04-21T12:00:00.000Z',
        id: 'chunk-1',
      },
    );
    expect(
      elasticsearchSyncService.bulkUpsertChunkDocuments,
    ).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      pageCount: 2,
      chunkCount: 2,
    });
  });

  it('ES 未启用时会直接报错', async () => {
    const service = new KnowledgeElasticsearchBackfillService(
      {
        isEnabled: jest.fn().mockReturnValue(false),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(service.backfillAll()).rejects.toThrow(
      'ELASTICSEARCH_ENABLED',
    );
  });
});
