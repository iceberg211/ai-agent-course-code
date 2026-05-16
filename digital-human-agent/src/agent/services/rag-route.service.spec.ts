import { RagRouteService } from '@/agent/services/rag-route.service';

describe('RagRouteService', () => {
  it('简单问题会被判定为 simple', async () => {
    const service = new RagRouteService();
    const invoke = jest.fn().mockResolvedValue({
      strategy: 'simple',
      reason: '直接问题',
    });

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(service.routeQuestion('萧峰是谁？')).resolves.toEqual({
      strategy: 'simple',
      reason: '直接问题',
    });
  });

  it('复杂问题会被判定为 complex', async () => {
    const service = new RagRouteService();
    const invoke = jest.fn().mockResolvedValue({
      strategy: 'complex',
      reason: '需要多步事实组合',
    });

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(
      service.routeQuestion('雁门关事件的主谋是谁，他儿子的结局又是什么？'),
    ).resolves.toEqual({
      strategy: 'complex',
      reason: '需要多步事实组合',
    });
  });

  it('LLM 路由失败时，直接关系类问题回退为 simple', async () => {
    const service = new RagRouteService();
    const invoke = jest.fn().mockRejectedValue(new Error('模型不可用'));

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(
      service.routeQuestion(
        '面向法务角色的系统讲解提纲和一、系统定位的包含子主题关系是什么？',
      ),
    ).resolves.toEqual({
      strategy: 'simple',
      reason: '启发式判断为直接实体关系问题',
    });
  });
});
