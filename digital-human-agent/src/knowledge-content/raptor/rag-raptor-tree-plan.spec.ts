import { buildRagRaptorTreePlan } from '@/knowledge-content/raptor/rag-raptor-tree-plan';

describe('rag raptor tree plan', () => {
  it('按 fanout 递归生成摘要节点计划，并保留 chunk 锚点', () => {
    const plan = buildRagRaptorTreePlan({
      knowledgeId: 'kb-1',
      fanout: 2,
      maxLayers: 3,
      chunks: [
        { id: 'chunk-1', content: '第一段内容', source: 'a.md', chunkIndex: 0 },
        { id: 'chunk-2', content: '第二段内容', source: 'a.md', chunkIndex: 1 },
        { id: 'chunk-3', content: '第三段内容', source: 'b.md', chunkIndex: 0 },
        { id: 'chunk-4', content: '第四段内容', source: 'b.md', chunkIndex: 1 },
        { id: 'chunk-5', content: '第五段内容', source: 'c.md', chunkIndex: 0 },
      ],
    });

    expect(plan.layers.map((layer) => layer.layer)).toEqual([1, 2, 3]);
    expect(plan.layers[0].nodes).toHaveLength(3);
    expect(plan.layers[0].nodes[0]).toMatchObject({
      layer: 1,
      sourceChunkIds: ['chunk-1', 'chunk-2'],
      childNodeKeys: [],
    });
    expect(plan.layers[1].nodes[0].childNodeKeys).toEqual([
      plan.layers[0].nodes[0].nodeKey,
      plan.layers[0].nodes[1].nodeKey,
    ]);
    expect(plan.rootNodeKey).toBe(plan.layers[2].nodes[0].nodeKey);
  });

  it('空 chunk 不生成计划', () => {
    expect(
      buildRagRaptorTreePlan({
        knowledgeId: 'kb-1',
        fanout: 5,
        maxLayers: 3,
        chunks: [],
      }),
    ).toEqual({
      rootNodeKey: null,
      layers: [],
      nodeCount: 0,
    });
  });
});
