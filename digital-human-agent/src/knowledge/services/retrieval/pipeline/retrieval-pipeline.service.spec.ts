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
      profileId: 'balanced_chat',
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

  it('空结果缓存命中时不再打 hybrid', async () => {
    const hybrid = {
      retrieveForPersona: jest.fn(),
    };
    const expand = { expand: jest.fn() };
    const personaKb = {
      listMountedKnowledgeConfigs: jest
        .fn()
        .mockResolvedValue([{ knowledgeId: 'kb-1' }]),
    };
    const aclEpoch = {
      getEpochs: jest.fn().mockResolvedValue({ 'kb-1': 1 }),
    };
    const cache = {
      getRetrievalResult: jest.fn().mockResolvedValue({
        chunks: [],
        knowledgeCount: 1,
        rerankLimit: 9,
      }),
      setRetrievalResult: jest.fn(),
    };
    const revisions = {
      getRevisions: jest.fn().mockResolvedValue({ 'kb-1': 1 }),
    };
    const service = new RetrievalPipelineService(
      hybrid as never,
      expand as never,
      aclEpoch as never,
      cache as never,
      personaKb as never,
      revisions as never,
    );

    const result = await service.retrieve({
      personaId: 'p1',
      profileId: 'balanced_chat',
      retrievalQueries: [
        { index: 0, query: '无结果问', keywords: ['无'], angle: 'original' },
      ],
      strategy: { ...DEFAULT_RETRIEVAL_STRATEGY },
      graphExpand: false,
    });

    expect(result.chunks).toEqual([]);
    expect(result.knowledgeCount).toBe(1);
    expect(result.rerankLimit).toBe(9);
    expect(hybrid.retrieveForPersona).not.toHaveBeenCalled();
    expect(cache.getRetrievalResult).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'balanced_chat' }),
    );
  });

  it('缓存 key 会区分所有影响召回结果的参数', async () => {
    const hybrid = {
      retrieveForPersona: jest.fn().mockResolvedValue({
        chunks: [baseChunk],
        trace: [],
        knowledgeCount: 1,
      }),
    };
    const expand = { expand: jest.fn() };
    const personaKb = {
      listMountedKnowledgeConfigs: jest
        .fn()
        .mockResolvedValue([{ knowledgeId: 'kb-1' }]),
    };
    const aclEpoch = {
      getEpochs: jest.fn().mockResolvedValue({ 'kb-1': 1 }),
    };
    const cache = {
      getRetrievalResult: jest.fn().mockResolvedValue(null),
      setRetrievalResult: jest.fn(),
    };
    const revisions = {
      getRevisions: jest.fn().mockResolvedValue({ 'kb-1': 1 }),
    };
    const service = new RetrievalPipelineService(
      hybrid as never,
      expand as never,
      aclEpoch as never,
      cache as never,
      personaKb as never,
      revisions as never,
    );
    const baseRequest = {
      personaId: 'p1',
      profileId: 'balanced_chat',
      retrievalQueries: [
        { index: 0, query: 'q', keywords: ['q'], angle: 'original' as const },
      ],
      strategy: { ...DEFAULT_RETRIEVAL_STRATEGY },
      graphExpand: false,
    };

    await service.retrieve({ ...baseRequest, threshold: 0.8, retrievalLimit: 5 });
    await service.retrieve({
      ...baseRequest,
      threshold: 0.5,
      retrievalLimit: 20,
      strategy: { ...DEFAULT_RETRIEVAL_STRATEGY, vectorTopK: 20 },
    });

    const first = cache.getRetrievalResult.mock.calls[0][0].queryKeyParts;
    const second = cache.getRetrievalResult.mock.calls[1][0].queryKeyParts;
    expect(first).not.toEqual(second);
    expect(second).toEqual(
      expect.arrayContaining([
        'threshold=0.5',
        'retrievalLimit=20',
        expect.stringContaining('"vectorTopK":20'),
        'knowledgeRevisions=kb-1:1',
      ]),
    );
  });
});
