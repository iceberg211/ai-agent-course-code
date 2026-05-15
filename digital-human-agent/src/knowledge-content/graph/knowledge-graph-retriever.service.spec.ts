import { KnowledgeGraphRetrieverService } from '@/knowledge-content/graph/knowledge-graph-retriever.service';

describe('KnowledgeGraphRetrieverService', () => {
  it('从已索引图谱关系返回关联 chunk，并保留图谱证据', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          content: '甲方应保留审计记录。',
          source: 'contract.md',
          chunk_index: 3,
          category: 'contract',
          graph_score: 0.82,
          graph_evidence: [
            {
              source: '甲方',
              target: '审计保留',
              relationType: 'MENTIONS',
              relationLabel: '提及',
              evidenceText: '甲方应保留审计记录。',
              confidence: 0.82,
            },
          ],
        },
      ]),
    };
    const service = new KnowledgeGraphRetrieverService(dataSource as never);

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      retrievalQuery: '甲方审计保留',
      keywordTerms: ['甲方', '审计保留'],
      matchCount: 5,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM rag_graph_edge e'),
      expect.arrayContaining([
        'kb-1',
        expect.arrayContaining(['%甲方%', '%审计保留%', '%甲方审计保留%']),
        5,
      ]),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'chunk-1',
        document_id: 'doc-1',
        knowledge_base_id: 'kb-1',
        content: '甲方应保留审计记录。',
        source: 'contract.md',
        chunk_index: 3,
        category: 'contract',
        retrieval_sources: ['graph'],
        graph_score: 0.82,
        graph_evidence: [
          expect.objectContaining({
            source: '甲方',
            target: '审计保留',
            relationType: 'MENTIONS',
          }),
        ],
      }),
    ]);
  });

  it('没有有效查询词时不访问数据库', async () => {
    const dataSource = {
      query: jest.fn(),
    };
    const service = new KnowledgeGraphRetrieverService(dataSource as never);

    await expect(
      service.retrieve({
        knowledgeId: 'kb-1',
        retrievalQuery: '   ',
        keywordTerms: [' ', ''],
        matchCount: 5,
      }),
    ).resolves.toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('path 模式会按 graphMaxHops 做递归路径检索', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          id: 'chunk-2',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          content: '验收通过后会触发付款流程。',
          source: 'contract.md',
          chunk_index: 4,
          category: 'contract',
          graph_score: 0.69,
          graph_evidence: [
            {
              source: '甲方',
              target: '验收',
              relationType: 'MENTIONS',
              relationLabel: '提及',
              evidenceText: '甲方负责组织验收。',
              confidence: 0.9,
            },
            {
              source: '验收',
              target: '付款流程',
              relationType: 'HAS_SUBTOPIC',
              relationLabel: '包含子主题',
              evidenceText: '验收通过后会触发付款流程。',
              confidence: 0.69,
            },
          ],
        },
      ]),
    };
    const service = new KnowledgeGraphRetrieverService(dataSource as never);

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      retrievalQuery: '甲方验收后的付款流程',
      keywordTerms: ['甲方', '验收'],
      matchCount: 5,
      graphMode: 'path',
      graphMaxHops: 3,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WITH RECURSIVE path_edges AS'),
      expect.arrayContaining([3]),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'chunk-2',
        retrieval_sources: ['graph'],
        graph_score: 0.69,
        graph_evidence: [
          expect.objectContaining({ source: '甲方', target: '验收' }),
          expect.objectContaining({ source: '验收', target: '付款流程' }),
        ],
      }),
    );
  });
});
