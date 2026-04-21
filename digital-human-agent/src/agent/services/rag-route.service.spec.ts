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
});
