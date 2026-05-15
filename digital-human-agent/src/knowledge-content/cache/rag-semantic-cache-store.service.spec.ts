import { RagSemanticCacheStoreService } from '@/knowledge-content/cache/rag-semantic-cache-store.service';

describe('RagSemanticCacheStoreService', () => {
  const baseEntry = {
    cacheKey: 'rag-semantic:v1:abc',
    personaId: '11111111-1111-1111-1111-111111111111',
    normalizedQueryHash: 'query-hash',
    query: '试用数据删除时限是什么？',
    queryEmbedding: [0.1, 0.2, 0.3],
    mountedKnowledgeBaseIds: ['kb-a'],
    mountedKnowledgeBaseFingerprints: ['kb-a:fingerprint'],
    retrievalConfig: { threshold: 0.6, stage1TopK: 20, finalTopK: 5, rerank: true },
    backend: { vector: 'pgvector', keyword: 'elastic' },
    models: { embeddings: 'text-embedding-v3', rerankerModel: 'qwen3-rerank' },
    strategyFlags: { useVector: true, useKeyword: true },
    indexVersions: { elasticsearch: 'v2', graph: null, chunking: 'markdown-structure-v1' },
    payload: { stage2ChunkIds: ['chunk-1'] },
  };

  afterEach(() => {
    delete process.env.RAG_SEMANTIC_CACHE_ENABLED;
    delete process.env.RAG_SEMANTIC_CACHE_TTL_SECONDS;
    delete process.env.RAG_SEMANTIC_CACHE_MIN_SIMILARITY;
  });

  it('默认关闭时不访问 Supabase，也不会写入缓存', async () => {
    const supabase = {
      from: jest.fn(),
      rpc: jest.fn(),
    };
    const service = new RagSemanticCacheStoreService(supabase as never);

    expect(service.isEnabled()).toBe(false);
    await expect(service.getByKey('cache-key')).resolves.toBeNull();
    await expect(service.findSimilar({
      personaId: baseEntry.personaId,
      queryEmbedding: baseEntry.queryEmbedding,
      mountedKnowledgeBaseFingerprints: baseEntry.mountedKnowledgeBaseFingerprints,
      retrievalConfig: baseEntry.retrievalConfig,
      models: baseEntry.models,
      strategyFlags: baseEntry.strategyFlags,
      indexVersions: baseEntry.indexVersions,
    })).resolves.toBeNull();
    await expect(service.upsert(baseEntry)).resolves.toEqual({
      written: false,
      reason: 'disabled',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('开启后会按 cache_key 精确读取未过期缓存', async () => {
    process.env.RAG_SEMANTIC_CACHE_ENABLED = 'true';
    const maybeSingle = jest.fn().mockResolvedValue({
      data: {
        cache_key: 'rag-semantic:v1:abc',
        payload: { stage2ChunkIds: ['chunk-1'] },
        similarity: null,
        expires_at: '2026-05-15T13:00:00.000Z',
      },
      error: null,
    });
    const gt = jest.fn().mockReturnValue({ maybeSingle });
    const eq = jest.fn().mockReturnValue({ gt });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const service = new RagSemanticCacheStoreService({ from } as never);

    await expect(service.getByKey('rag-semantic:v1:abc')).resolves.toEqual({
      cacheKey: 'rag-semantic:v1:abc',
      payload: { stage2ChunkIds: ['chunk-1'] },
      similarity: null,
      expiresAt: '2026-05-15T13:00:00.000Z',
    });
    expect(from).toHaveBeenCalledWith('rag_semantic_cache');
    expect(eq).toHaveBeenCalledWith('cache_key', 'rag-semantic:v1:abc');
  });

  it('开启后会通过 RPC 查找相似查询缓存', async () => {
    process.env.RAG_SEMANTIC_CACHE_ENABLED = 'true';
    process.env.RAG_SEMANTIC_CACHE_MIN_SIMILARITY = '0.92';
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          cache_key: 'rag-semantic:v1:abc',
          payload: { stage2ChunkIds: ['chunk-1'] },
          similarity: 0.95,
          expires_at: '2026-05-15T13:00:00.000Z',
        },
      ],
      error: null,
    });
    const service = new RagSemanticCacheStoreService({ rpc } as never);

    await expect(service.findSimilar({
      personaId: baseEntry.personaId,
      queryEmbedding: baseEntry.queryEmbedding,
      mountedKnowledgeBaseFingerprints: baseEntry.mountedKnowledgeBaseFingerprints,
      retrievalConfig: baseEntry.retrievalConfig,
      models: baseEntry.models,
      strategyFlags: baseEntry.strategyFlags,
      indexVersions: baseEntry.indexVersions,
    })).resolves.toEqual({
      cacheKey: 'rag-semantic:v1:abc',
      payload: { stage2ChunkIds: ['chunk-1'] },
      similarity: 0.95,
      expiresAt: '2026-05-15T13:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('match_rag_semantic_cache', {
      p_persona_id: baseEntry.personaId,
      p_query_embedding: '[0.1,0.2,0.3]',
      p_mounted_knowledge_base_fingerprints: baseEntry.mountedKnowledgeBaseFingerprints,
      p_retrieval_config: baseEntry.retrievalConfig,
      p_models: baseEntry.models,
      p_strategy_flags: baseEntry.strategyFlags,
      p_index_versions: baseEntry.indexVersions,
      p_min_similarity: 0.92,
      p_match_count: 1,
    });
  });

  it('开启后会带 TTL upsert 缓存记录', async () => {
    process.env.RAG_SEMANTIC_CACHE_ENABLED = 'true';
    process.env.RAG_SEMANTIC_CACHE_TTL_SECONDS = '60';
    jest
      .useFakeTimers()
      .setSystemTime(new Date('2026-05-15T12:00:00.000Z').getTime());
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    const service = new RagSemanticCacheStoreService({ from } as never);

    await expect(service.upsert(baseEntry)).resolves.toEqual({ written: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cache_key: baseEntry.cacheKey,
        persona_id: baseEntry.personaId,
        query_embedding: '[0.1,0.2,0.3]',
        payload: baseEntry.payload,
        expires_at: '2026-05-15T12:01:00.000Z',
      }),
      { onConflict: 'cache_key' },
    );

    jest.useRealTimers();
  });
});
