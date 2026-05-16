import { RagSemanticCacheCoordinatorService } from '@/knowledge-content/services/rag-semantic-cache-coordinator.service';
import type { MountedKnowledgeConfig } from '@/knowledge-content/services/knowledge-retrieval.types';
import type { RetrieveKnowledgeDebugResult } from '@/knowledge-content/types/knowledge-content.types';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';

describe('RagSemanticCacheCoordinatorService', () => {
  const strategy: RetrievalStrategy = {
    needRetrieval: true,
    useVector: false,
    useKeyword: true,
    useGraph: false,
    useExactPhrase: false,
    useMultiQuery: false,
    useHyDE: false,
    allowWeb: false,
    reason: '测试',
  };
  const knowledgeConfigs: MountedKnowledgeConfig[] = [
    {
      knowledgeId: 'kb-1',
      threshold: 0.6,
      stage1TopK: 10,
      retrievalConfig: {},
      updatedAt: '2026-05-15T10:00:00.000Z',
    },
  ];
  const cachedResult: Omit<RetrieveKnowledgeDebugResult, 'cache'> = {
    query: '原始问题',
    retrievalQuery: '原始问题',
    retrievalQueries: [],
    rewrite: {
      originalQuery: '原始问题',
      rewrittenQuery: '原始问题',
      keywords: [],
      expandedQueries: [],
      changed: false,
      reason: 'cached',
    },
    options: {
      threshold: 0.6,
      rerank: false,
      stage1TopK: 10,
      finalTopK: 5,
      skipQueryRewrite: true,
    },
    stage1Trace: [],
    stage1: [],
    stage2: [],
  };

  it('命中 exact cache 时返回带 cache 标记的调试结果', async () => {
    const runtime = {
      supabase: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      },
      embeddings: {
        embedQuery: jest.fn(),
      },
      withTransientRetry: jest.fn(),
    };
    const semanticCacheStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      getByKey: jest.fn().mockResolvedValue({
        cacheKey: 'rag-semantic:v1:cached',
        similarity: 1,
        payload: { result: cachedResult },
      }),
      findSimilar: jest.fn(),
      upsert: jest.fn(),
    };
    const service = new RagSemanticCacheCoordinatorService(
      runtime as never,
      semanticCacheStore as never,
    );

    const resolution = await service.resolve({
      personaId: 'persona-1',
      normalizedQuery: '原始问题',
      normalizedOptions: cachedResult.options,
      strategy,
      knowledgeConfigs,
    });

    expect(resolution.cachedResult?.cache).toMatchObject({
      enabled: true,
      lookup: 'exact-hit',
      cacheKey: 'rag-semantic:v1:cached',
      written: false,
    });
    expect(semanticCacheStore.findSimilar).not.toHaveBeenCalled();
  });
});
