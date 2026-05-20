import { QueryAugmentationService } from '@/agent/services/query/query-augmentation.service';
import { QueryRewriteService } from '@/knowledge/services/retrieval/query-rewrite.service';

describe('QueryAugmentationService', () => {
  const realQueryRewrite = new QueryRewriteService(null as any);

  it('复杂问题会保留原问题并最多生成三条去重检索 query', async () => {
    const queryRewriteService = {
      rewrite: jest.fn().mockResolvedValue({
        originalQuery: '雁门关主谋和他儿子的结局是什么？',
        rewrittenQuery: '雁门关主谋是谁',
        keywords: ['雁门关', '主谋'],
        expandedQueries: [
          {
            index: 0,
            query: '雁门关主谋是谁',
            keywords: ['雁门关', '主谋'],
            angle: 'original',
          },
          {
            index: 1,
            query: '慕容博的儿子结局是什么',
            keywords: ['慕容博', '儿子', '结局'],
            angle: 'entity',
          },
          {
            index: 2,
            query: '雁门关主谋是谁',
            keywords: ['雁门关', '主谋'],
            angle: 'semantic',
          },
        ],
        changed: true,
        reason: '补全实体关系',
      }),
      buildFallbackRewrite: realQueryRewrite.buildFallbackRewrite.bind(realQueryRewrite),
      resolveRetrievalQueries: realQueryRewrite.resolveRetrievalQueries.bind(realQueryRewrite),
    };
    const service = new QueryAugmentationService(queryRewriteService as never);

    const result = await service.plan({
      question: '雁门关主谋和他儿子的结局是什么？',
      routeStrategy: 'complex',
      signal: new AbortController().signal,
    });

    expect(queryRewriteService.rewrite).toHaveBeenCalled();
    expect(result.retrievalQueries).toEqual([
      {
        index: 0,
        query: '雁门关主谋和他儿子的结局是什么？',
        keywords: expect.any(Array),
        angle: 'original',
      },
      {
        index: 1,
        query: '雁门关主谋是谁',
        keywords: ['雁门关', '主谋'],
        angle: 'semantic',
      },
      {
        index: 2,
        query: '慕容博的儿子结局是什么',
        keywords: ['慕容博', '儿子', '结局'],
        angle: 'entity',
      },
    ]);
    expect(result.strategy.useMultiQuery).toBe(true);
  });

  it('rewrite 失败时只回退原始问题，不额外凑 query', async () => {
    const queryRewriteService = {
      rewrite: jest.fn().mockRejectedValue(new Error('llm timeout')),
      buildFallbackRewrite: realQueryRewrite.buildFallbackRewrite.bind(realQueryRewrite),
      resolveRetrievalQueries: realQueryRewrite.resolveRetrievalQueries.bind(realQueryRewrite),
    };
    const service = new QueryAugmentationService(queryRewriteService as never);

    const result = await service.plan({
      question: '合同终止后试用数据如何处理？',
      routeStrategy: 'complex',
      signal: new AbortController().signal,
    });

    expect(result.retrievalQueries).toEqual([
      {
        index: 0,
        query: '合同终止后试用数据如何处理？',
        keywords: expect.any(Array),
        angle: 'original',
      },
    ]);
    expect(result.strategy.useMultiQuery).toBe(false);
  });
});
