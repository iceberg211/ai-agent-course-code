import { buildKnowledgeParentChildUpsertPlan } from '@/knowledge-content/parent-child/knowledge-parent-child-plan';

describe('buildKnowledgeParentChildUpsertPlan', () => {
  it('按文档顺序把连续小 chunk 聚合为稳定 parent chunk', () => {
    const plan = buildKnowledgeParentChildUpsertPlan({
      documentId: 'doc-1',
      indexVersion: 'parent-child-v1',
      maxParentChars: 1200,
      maxChildChunks: 3,
      chunks: [
        {
          id: 'chunk-2',
          chunkIndex: 2,
          source: 'guide.md',
          category: 'faq',
          content: '第三段',
        },
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
        {
          id: 'chunk-3',
          chunkIndex: 3,
          source: 'guide.md',
          category: 'faq',
          content: '第四段',
        },
      ],
    });

    expect(plan).toMatchObject({
      documentId: 'doc-1',
      indexVersion: 'parent-child-v1',
    });
    expect(plan.parentChunks).toEqual([
      expect.objectContaining({
        parentKey: 'ParentChunk:doc-1:parent-child-v1:0-2',
        startChunkIndex: 0,
        endChunkIndex: 2,
        childChunkIds: ['chunk-0', 'chunk-1', 'chunk-2'],
        content: ['第一段', '第二段', '第三段'].join('\n\n'),
        source: 'guide.md',
        category: 'faq',
      }),
      expect.objectContaining({
        parentKey: 'ParentChunk:doc-1:parent-child-v1:3-3',
        startChunkIndex: 3,
        endChunkIndex: 3,
        childChunkIds: ['chunk-3'],
        content: '第四段',
      }),
    ]);
  });

  it('单个超长 chunk 会独立成为 parent chunk，避免丢失原文', () => {
    const plan = buildKnowledgeParentChildUpsertPlan({
      documentId: 'doc-1',
      indexVersion: 'parent-child-v1',
      maxParentChars: 10,
      maxChildChunks: 5,
      chunks: [
        {
          id: 'chunk-0',
          chunkIndex: 0,
          source: 'guide.md',
          category: null,
          content: '这是一段超过限制但不能被丢弃的内容',
        },
        {
          id: 'chunk-1',
          chunkIndex: 1,
          source: 'guide.md',
          category: null,
          content: '短句',
        },
      ],
    });

    expect(plan.parentChunks).toHaveLength(2);
    expect(plan.parentChunks[0]).toMatchObject({
      parentKey: 'ParentChunk:doc-1:parent-child-v1:0-0',
      childChunkIds: ['chunk-0'],
    });
  });
});
