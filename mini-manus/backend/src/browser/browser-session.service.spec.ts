import { ConfigService } from '@nestjs/config';
import { BrowserSessionService } from '@/browser/browser-session.service';

function createConfig(values: Record<string, string | number | undefined>) {
  return {
    get: jest.fn(<T = string | number | undefined>(key: string) => {
      return values[key] as T;
    }),
  } as unknown as ConfigService;
}

describe('BrowserSessionService', () => {
  it('默认未启用时拒绝打开浏览器', async () => {
    const service = new BrowserSessionService(createConfig({}));

    await expect(
      service.open({
        taskId: '00000000-0000-4000-8000-000000000001',
        runId: '00000000-0000-4000-8000-000000000002',
        url: 'https://example.com',
      }),
    ).rejects.toThrow('浏览器自动化未启用');
  });
});
