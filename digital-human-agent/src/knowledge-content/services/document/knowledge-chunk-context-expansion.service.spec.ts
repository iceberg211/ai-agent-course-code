import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/document/knowledge-chunk-context-expansion.service';

describe('KnowledgeChunkContextExpansionService', () => {
  function createService() {
    const repo = {
      find: jest.fn(),
    };
    const service = new KnowledgeChunkContextExpansionService(repo as never);

    return {
      repo,
      service,
    };
  }

  it('显式窗口开启时，会按命中 chunk 的文档顺序带入前后邻居并保留原命中元数据', async () => {
    const { repo, service } = createService();
    const hit = {
      id: 'chunk-2',
      document_id: 'doc-1',
      content: '命中段落',
      source: 'qa.md',
      chunk_index: 2,
      category: 'faq',
      similarity: 0.91,
      hybrid_score: 0.88,
    };
    repo.find.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: 'doc-1',
        content: '上文',
        source: 'qa.md',
        chunkIndex: 1,
        category: 'faq',
      },
      {
        id: 'chunk-2',
        documentId: 'doc-1',
        content: '数据库里的命中段落',
        source: 'qa.md',
        chunkIndex: 2,
        category: 'faq',
      },
      {
        id: 'chunk-3',
        documentId: 'doc-1',
        content: '下文',
        source: 'qa.md',
        chunkIndex: 3,
        category: 'faq',
      },
    ]);

    const expanded = await service.expand([hit], 1);

    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(expanded.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
      'chunk-3',
    ]);
    expect(expanded[1]).toBe(hit);
    expect(expanded[0]).toMatchObject({
      context_expanded: true,
      similarity: 0,
    });
  });

  it('不会把同文档但不在任一命中窗口内的中间段落误带入上下文', async () => {
    const { repo, service } = createService();
    repo.find.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: 'doc-1',
        content: '第 1 段',
        source: 'qa.md',
        chunkIndex: 1,
        category: null,
      },
      {
        id: 'chunk-6',
        documentId: 'doc-1',
        content: '不相邻段落',
        source: 'qa.md',
        chunkIndex: 6,
        category: null,
      },
      {
        id: 'chunk-9',
        documentId: 'doc-1',
        content: '第 9 段',
        source: 'qa.md',
        chunkIndex: 9,
        category: null,
      },
    ]);

    const expanded = await service.expand(
      [
        {
          id: 'chunk-2',
          document_id: 'doc-1',
          content: '第 2 段',
          source: 'qa.md',
          chunk_index: 2,
          category: null,
          similarity: 0.9,
        },
        {
          id: 'chunk-10',
          document_id: 'doc-1',
          content: '第 10 段',
          source: 'qa.md',
          chunk_index: 10,
          category: null,
          similarity: 0.8,
        },
      ],
      1,
    );

    expect(expanded.map((item) => item.id)).toEqual([
      'chunk-1',
      'chunk-2',
      'chunk-9',
      'chunk-10',
    ]);
  });

  it('窗口为 0 时不查询数据库并直接返回原结果', async () => {
    const { repo, service } = createService();
    const chunks = [
      {
        id: 'chunk-1',
        document_id: 'doc-1',
        content: '命中段落',
        source: 'qa.md',
        chunk_index: 1,
        category: null,
        similarity: 0.9,
      },
    ];

    await expect(service.expand(chunks, 0)).resolves.toBe(chunks);
    expect(repo.find).not.toHaveBeenCalled();
  });
});
