import { createAbortError } from '@/agent/agent.utils';
import { RetrievalStrategyService } from '@/agent/services/retrieval-strategy.service';

describe('RetrievalStrategyService', () => {
  function createServiceWithFailingLlm() {
    const service = new RetrievalStrategyService();
    const invoke = jest.fn().mockRejectedValue(new Error('planner failed'));
    Object.assign(service as unknown as { llm: unknown }, {
      llm: {
        withStructuredOutput: jest.fn(() => ({
          invoke,
        })),
      },
    });
    return {
      service,
      invoke,
    };
  }

  it('LLM 失败且是寒暄问题时，回退为跳过检索策略', async () => {
    const { service } = createServiceWithFailingLlm();

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
      reason: '寒暄或礼貌表达，不需要查知识库',
    });
  });

  it('LLM 失败且问题包含明确短语时，回退策略会启用 exact phrase', async () => {
    const { service } = createServiceWithFailingLlm();

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
      useMultiQuery: true,
      queryCount: 2,
      allowWeb: true,
    });
  });

  it('用户中断时不降级为 fallback 策略', async () => {
    const { service, invoke } = createServiceWithFailingLlm();
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
    expect(invoke).not.toHaveBeenCalled();
  });
});
