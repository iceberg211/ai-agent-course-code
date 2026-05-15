import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';

describe('KnowledgeGraphExtractorService', () => {
  const service = new KnowledgeGraphExtractorService();

  it('从 Markdown 标题抽取 Topic 节点和层级关系', async () => {
    const graph = await service.extract({
      documentId: 'doc-1',
      chunks: [
        {
          id: 'chunk-1',
          chunkIndex: 0,
          source: 'contract.md',
          content: '# 服务协议\n正文\n## 删除要求\n用户可以删除资料。',
        },
      ],
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { type: 'Topic', name: '服务协议' },
        { type: 'Topic', name: '删除要求' },
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { type: 'Topic', name: '服务协议' },
          target: { type: 'Topic', name: '删除要求' },
          relationType: 'HAS_SUBTOPIC',
          chunkId: 'chunk-1',
          confidence: 0.85,
        }),
      ]),
    );
  });

  it('把明确参与方词汇连接到当前主题', async () => {
    const graph = await service.extract({
      documentId: 'doc-1',
      chunks: [
        {
          id: 'chunk-1',
          chunkIndex: 0,
          source: 'contract.md',
          content: '# 审计保留\n甲方应保留审计记录，乙方可以请求导出。',
        },
      ],
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { type: 'Topic', name: '审计保留' },
        { type: 'Entity', name: '甲方', entityType: 'Party' },
        { type: 'Entity', name: '乙方', entityType: 'Party' },
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { type: 'Entity', name: '甲方', entityType: 'Party' },
          target: { type: 'Topic', name: '审计保留' },
          relationType: 'MENTIONS',
          chunkId: 'chunk-1',
          evidenceText: expect.stringContaining('甲方'),
        }),
        expect.objectContaining({
          source: { type: 'Entity', name: '乙方', entityType: 'Party' },
          target: { type: 'Topic', name: '审计保留' },
          relationType: 'MENTIONS',
          chunkId: 'chunk-1',
          evidenceText: expect.stringContaining('乙方'),
        }),
      ]),
    );
  });
});
