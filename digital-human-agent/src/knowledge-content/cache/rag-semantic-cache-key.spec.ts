import {
  buildMountedKnowledgeBaseCacheFingerprint,
  buildRagSemanticCacheKey,
} from '@/knowledge-content/cache/rag-semantic-cache-key';

describe('buildRagSemanticCacheKey', () => {
  const baseInput = {
    query: '  试用数据 删除时限 是什么？ ',
    personaId: 'persona-1',
    mountedKnowledgeBases: [
      {
        id: 'kb-b',
        fingerprint: 'kb-b:doc-count=2:max-doc=2026-01-02:chunks=20',
      },
      {
        id: 'kb-a',
        fingerprint: 'kb-a:doc-count=1:max-doc=2026-01-01:chunks=5',
      },
    ],
    retrievalConfig: {
      threshold: 0.6,
      stage1TopK: 20,
      finalTopK: 5,
      rerank: true,
    },
    embeddingModel: 'text-embedding-v3',
    rerankerProvider: 'dashscope',
    rerankerModel: 'qwen3-rerank',
    allowWeb: true,
    strategyFlags: {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: true,
      useMultiQuery: true,
      useHyDE: false,
      allowWeb: true,
      queryCount: 3,
      chunkContextWindow: 1,
      parentContext: true,
      parentContextMaxChars: 2000,
      contextCompression: true,
      lostInMiddle: true,
      reason: '测试策略',
    },
    indexVersions: {
      elasticsearch: 'v1',
      graph: null,
      chunking: 'markdown-structure-v1',
    },
  };

  it('生成稳定缓存键，并把跨 persona 串结果相关字段写入 material', () => {
    const result = buildRagSemanticCacheKey(baseInput);

    expect(result.key).toMatch(/^rag-semantic:v1:[a-f0-9]{64}$/);
    expect(result.material).toMatchObject({
      personaId: 'persona-1',
      mountedKnowledgeBaseIds: ['kb-a', 'kb-b'],
      mountedKnowledgeBaseFingerprints: [
        'kb-a:doc-count=1:max-doc=2026-01-01:chunks=5',
        'kb-b:doc-count=2:max-doc=2026-01-02:chunks=20',
      ],
      retrievalConfig: {
        threshold: 0.6,
        stage1TopK: 20,
        finalTopK: 5,
        rerank: true,
      },
      embeddingModel: 'text-embedding-v3',
      rerankerProvider: 'dashscope',
      rerankerModel: 'qwen3-rerank',
      allowWeb: true,
      strategyFlags: {
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: true,
        useMultiQuery: true,
        useHyDE: false,
        queryCount: 3,
        chunkContextWindow: 1,
        parentContext: true,
        parentContextMaxChars: 2000,
        contextCompression: true,
        lostInMiddle: true,
      },
      indexVersions: {
        elasticsearch: 'v1',
        graph: null,
        chunking: 'markdown-structure-v1',
      },
    });
    expect(result.material.normalizedQueryHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('挂载知识库输入顺序不同不会改变缓存键', () => {
    const left = buildRagSemanticCacheKey(baseInput);
    const right = buildRagSemanticCacheKey({
      ...baseInput,
      mountedKnowledgeBases: [...baseInput.mountedKnowledgeBases].reverse(),
    });

    expect(right.key).toBe(left.key);
    expect(right.material.mountedKnowledgeBaseIds).toEqual(['kb-a', 'kb-b']);
  });

  it('reranker、策略或 web flag 变化时会生成不同缓存键', () => {
    const base = buildRagSemanticCacheKey(baseInput).key;

    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        rerankerProvider: 'llm-json',
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        allowWeb: false,
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        strategyFlags: {
          ...baseInput.strategyFlags,
          useHyDE: true,
        },
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        strategyFlags: {
          ...baseInput.strategyFlags,
          chunkContextWindow: 2,
        },
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        strategyFlags: {
          ...baseInput.strategyFlags,
          parentContextMaxChars: 3000,
        },
      }).key,
    ).not.toBe(base);
  });

  it('persona、知识库版本、检索配置、模型和索引版本变化时会隔离缓存键', () => {
    const base = buildRagSemanticCacheKey(baseInput).key;

    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        personaId: 'persona-2',
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        mountedKnowledgeBases: [
          {
            id: 'kb-a',
            fingerprint: 'kb-a:doc-count=1:max-doc=2026-02-01:chunks=6',
          },
          baseInput.mountedKnowledgeBases[0],
        ],
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        retrievalConfig: {
          ...baseInput.retrievalConfig,
          stage1TopK: 30,
        },
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        embeddingModel: 'text-embedding-v4',
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        rerankerModel: 'qwen3-rerank-next',
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        indexVersions: {
          ...baseInput.indexVersions,
          elasticsearch: 'v2',
        },
      }).key,
    ).not.toBe(base);
    expect(
      buildRagSemanticCacheKey({
        ...baseInput,
        strategyFlags: {
          ...baseInput.strategyFlags,
          useGraph: true,
          graphMode: 'entity_path',
          graphMaxHops: 2,
        },
      }).key,
    ).not.toBe(base);
  });

  it('从知识库统计生成稳定 fingerprint，并随内容、配置和索引版本变化', () => {
    const base = buildMountedKnowledgeBaseCacheFingerprint({
      id: 'kb-a',
      updatedAt: '2026-05-15T10:00:00.000Z',
      documentCount: 2,
      completedDocumentCount: 2,
      chunkCount: 20,
      maxDocumentCreatedAt: '2026-05-15T09:00:00.000Z',
      maxChunkCreatedAt: '2026-05-15T09:05:00.000Z',
      retrievalConfig: {
        threshold: 0.6,
        stage1TopK: 20,
        finalTopK: 5,
        rerank: true,
      },
      indexVersions: {
        elasticsearch: 'v2',
        graph: null,
        chunking: 'markdown-structure-v1',
      },
    });

    expect(base).toEqual({
      id: 'kb-a',
      fingerprint: expect.stringMatching(/^kb-fingerprint:v1:kb-a:[a-f0-9]{64}$/),
    });
    expect(
      buildMountedKnowledgeBaseCacheFingerprint({
        id: 'kb-a',
        updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        documentCount: 2,
        completedDocumentCount: 2,
        chunkCount: 20,
        maxDocumentCreatedAt: new Date('2026-05-15T09:00:00.000Z'),
        maxChunkCreatedAt: new Date('2026-05-15T09:05:00.000Z'),
        retrievalConfig: {
          threshold: 0.6,
          stage1TopK: 20,
          finalTopK: 5,
          rerank: true,
        },
        indexVersions: {
          elasticsearch: 'v2',
          graph: null,
          chunking: 'markdown-structure-v1',
        },
      }).fingerprint,
    ).toBe(base.fingerprint);

    expect(
      buildMountedKnowledgeBaseCacheFingerprint({
        id: 'kb-a',
        updatedAt: '2026-05-15T10:00:00.000Z',
        documentCount: 2,
        completedDocumentCount: 2,
        chunkCount: 21,
        maxDocumentCreatedAt: '2026-05-15T09:00:00.000Z',
        maxChunkCreatedAt: '2026-05-15T09:05:00.000Z',
        retrievalConfig: {
          threshold: 0.6,
          stage1TopK: 20,
          finalTopK: 5,
          rerank: true,
        },
        indexVersions: {
          elasticsearch: 'v2',
          graph: null,
          chunking: 'markdown-structure-v1',
        },
      }).fingerprint,
    ).not.toBe(base.fingerprint);
    expect(
      buildMountedKnowledgeBaseCacheFingerprint({
        id: 'kb-a',
        updatedAt: '2026-05-15T10:00:00.000Z',
        documentCount: 2,
        completedDocumentCount: 2,
        chunkCount: 20,
        maxDocumentCreatedAt: '2026-05-15T09:00:00.000Z',
        maxChunkCreatedAt: '2026-05-15T09:05:00.000Z',
        retrievalConfig: {
          threshold: 0.7,
          stage1TopK: 20,
          finalTopK: 5,
          rerank: true,
        },
        indexVersions: {
          elasticsearch: 'v2',
          graph: null,
          chunking: 'markdown-structure-v1',
        },
      }).fingerprint,
    ).not.toBe(base.fingerprint);
    expect(
      buildMountedKnowledgeBaseCacheFingerprint({
        id: 'kb-a',
        updatedAt: '2026-05-15T10:00:00.000Z',
        documentCount: 2,
        completedDocumentCount: 2,
        chunkCount: 20,
        maxDocumentCreatedAt: '2026-05-15T09:00:00.000Z',
        maxChunkCreatedAt: '2026-05-15T09:05:00.000Z',
        retrievalConfig: {
          threshold: 0.6,
          stage1TopK: 20,
          finalTopK: 5,
          rerank: true,
        },
        indexVersions: {
          elasticsearch: 'v3',
          graph: null,
          chunking: 'markdown-structure-v1',
        },
      }).fingerprint,
    ).not.toBe(base.fingerprint);
  });
});
