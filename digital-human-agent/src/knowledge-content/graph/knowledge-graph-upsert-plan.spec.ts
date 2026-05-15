import {
  DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION,
  DEFAULT_RAG_GRAPH_SCHEMA_VERSION,
  buildKnowledgeGraphUpsertPlan,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';

describe('buildKnowledgeGraphUpsertPlan', () => {
  it('为 document/chunk 和抽取节点生成稳定 key，并去重重复关系', () => {
    const plan = buildKnowledgeGraphUpsertPlan({
      documentId: 'doc-1',
      chunks: [
        {
          id: 'chunk-1',
          chunkIndex: 0,
          source: 'contract.md',
          content: '甲方负责审计保留。',
        },
      ],
      extractedGraph: {
        nodes: [
          {
            type: 'Entity',
            name: ' 甲方 ',
            entityType: 'Party',
            aliases: ['客户'],
          },
          {
            type: 'Entity',
            name: '甲方',
            entityType: 'Party',
          },
          {
            type: 'Topic',
            name: '审计保留',
          },
        ],
        edges: [
          {
            source: { type: 'Entity', name: '甲方', entityType: 'Party' },
            target: { type: 'Topic', name: '审计保留' },
            relationType: 'RELATED_TO',
            relationLabel: '负责',
            chunkId: 'chunk-1',
            confidence: 0.8,
            evidenceText: '甲方负责审计保留。',
          },
          {
            source: { type: 'Entity', name: '甲方', entityType: 'Party' },
            target: { type: 'Topic', name: '审计保留' },
            relationType: 'RELATED_TO',
            relationLabel: '负责',
            chunkId: 'chunk-1',
            confidence: 0.8,
            evidenceText: '甲方负责审计保留。',
          },
        ],
      },
    });

    expect(plan.documentId).toBe('doc-1');
    expect(plan.extractorVersion).toBe(DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION);
    expect(plan.schemaVersion).toBe(DEFAULT_RAG_GRAPH_SCHEMA_VERSION);
    expect(plan.nodes.map((node) => node.nodeKey)).toEqual([
      'Document:doc-1',
      'Chunk:chunk-1',
      'Entity:Party:甲方',
      'Topic:审计保留',
    ]);
    expect(plan.edges).toHaveLength(2);
    expect(plan.edges.map((edge) => edge.edgeKey)).toEqual([
      'Document:doc-1->HAS_CHUNK->Chunk:chunk-1@doc-1:chunk-1:graph-extractor-v1',
      'Entity:Party:甲方->RELATED_TO->Topic:审计保留@doc-1:chunk-1:graph-extractor-v1',
    ]);
  });
});
