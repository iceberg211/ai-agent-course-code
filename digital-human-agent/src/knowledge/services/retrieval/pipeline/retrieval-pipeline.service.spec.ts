import { RetrievalPipelineService } from '@/knowledge/services/retrieval/pipeline/retrieval-pipeline.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import { DEFAULT_RETRIEVAL_STRATEGY } from '@/common/rag';

describe('RetrievalPipelineService', () => {
  const baseChunk: KnowledgeChunk = {
    id: 'c1',
    content: '向量命中',
    source: 'a.md',
    chunk_index: 0,
    category: null,
    similarity: 0.9,
    retrieval_sources: ['vector'],
  };

  it('graphExpand=false 时只返回 hybrid 结果', async () => {
    const hybrid = {
      retrieveForPersona: jest.fn().mockResolvedValue({
        chunks: [baseChunk],
        trace: [{ knowledgeId: 'kb-1' }],
        knowledgeCount: 1,
        rerankLimit: 5,
      }),
    };
    const expand = {
      expand: jest.fn(),
    };
    const service = new RetrievalPipelineService(
      hybrid as never,
      expand as never,
    );

    const result = await service.retrieve({
      personaId: 'p1',
      retrievalQueries: [
        { index: 0, query: 'q', keywords: ['q'], angle: 'original' },
      ],
      strategy: { ...DEFAULT_RETRIEVAL_STRATEGY, useGraph: true },
      graphExpand: false,
      question: 'q',
    });

    expect(expand.expand).not.toHaveBeenCalled();
    expect(result.chunks).toEqual([baseChunk]);
    expect(result.graphExpandTrace?.[0]?.skipped).toBe(true);
  });

  it('graphExpand=true 时合并 expand 邻居 chunk', async () => {
    const neighbor: KnowledgeChunk = {
      id: 'c2',
      content: '图谱邻居',
      source: 'b.md',
      chunk_index: 1,
      category: null,
      similarity: 0,
      graph_score: 0.8,
      retrieval_sources: ['graph'],
    };
    const hybrid = {
      retrieveForPersona: jest.fn().mockResolvedValue({
        chunks: [baseChunk],
        trace: [],
        knowledgeCount: 1,
        rerankLimit: 5,
      }),
    };
    const expand = {
      expand: jest.fn().mockResolvedValue({
        chunks: [baseChunk],
        expandedChunks: [neighbor],
        skipped: false,
        trace: [
          {
            knowledgeId: 'kb-1',
            matchedEntities: [{ key: 'e1', name: '实体' }],
            expandedChunkIds: ['c2'],
            expandedChunkCount: 1,
          },
        ],
      }),
    };
    const service = new RetrievalPipelineService(
      hybrid as never,
      expand as never,
    );

    const result = await service.retrieve({
      personaId: 'p1',
      retrievalQueries: [
        { index: 0, query: 'q', keywords: ['q'], angle: 'original' },
      ],
      strategy: { ...DEFAULT_RETRIEVAL_STRATEGY, useGraph: true },
      graphExpand: true,
      question: '实体关系',
      currentQuery: '实体关系',
    });

    expect(expand.expand).toHaveBeenCalled();
    expect(result.chunks.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(result.graphExpandTrace?.[0]?.expandedChunkCount).toBe(1);
  });
});
