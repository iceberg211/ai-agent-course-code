import { createAbortError } from '@/common/utils';
import { RetrievalStrategyService } from '@/agent/services/retrieval-strategy.service';

describe('RetrievalStrategyService', () => {
  function createService() {
    const service = new RetrievalStrategyService();
    return {
      service,
    };
  }

  it('寒暄问题会跳过检索', async () => {
    const { service } = createService();

    await expect(
      service.plan({
        question: '你好',
        currentQuery: '你好',
        routeStrategy: 'simple',
        remainingHops: 0,
      }),
    ).resolves.toMatchObject({
      needRetrieval: false,
      useVector: false,
      useKeyword: false,
      useGraph: false,
      allowWeb: false,
      reason: '寒暄问题，不需要查知识库',
    });
  });

  it('问题包含明确短语时，规则策略会启用 exact phrase', async () => {
    const { service } = createService();

    await expect(
      service.plan({
        question: '合同第七条的删除期限是什么？',
        currentQuery: '合同第七条的删除期限是什么？',
        routeStrategy: 'simple',
        remainingHops: 0,
      }),
    ).resolves.toMatchObject({
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useExactPhrase: true,
      useMultiQuery: false,
      queryCount: 1,
      allowWeb: true,
    });
  });

  it('显式开启 Graph 后，关系型问题会把图谱作为补充召回通道', async () => {
    const originalGraphFlag = process.env.NEO4J_GRAPH_ENABLED;
    process.env.NEO4J_GRAPH_ENABLED = 'true';
    const { service } = createService();

    try {
      await expect(
        service.plan({
          question: '合同第十一条里乙方和甲方的数据处理关系是什么？',
          currentQuery: '合同第十一条里乙方和甲方的数据处理关系是什么？',
          routeStrategy: 'complex',
          remainingHops: 1,
        }),
      ).resolves.toMatchObject({
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: true,
        graphMode: 'path',
        graphMaxHops: 2,
      });
    } finally {
      if (originalGraphFlag === undefined) {
        delete process.env.NEO4J_GRAPH_ENABLED;
      } else {
        process.env.NEO4J_GRAPH_ENABLED = originalGraphFlag;
      }
    }
  });

  it('用户中断时直接抛出 AbortError', async () => {
    const { service } = createService();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.plan(
        {
          question: '合同第七条的删除期限是什么？',
          currentQuery: '合同第七条的删除期限是什么？',
          routeStrategy: 'simple',
          remainingHops: 0,
        },
        abortController.signal,
      ),
    ).rejects.toMatchObject(createAbortError());
  });
});
