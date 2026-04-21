import { WebFallbackService } from '@/agent/services/web-fallback.service';

describe('WebFallbackService', () => {
  const originalApiKey = process.env.BOCHA_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.BOCHA_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('会把联网搜索结果转换成网页引用', async () => {
    process.env.BOCHA_API_KEY = 'test-key';
    const service = new WebFallbackService();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        data: {
          webPages: {
            value: [
              {
                name: '雁门关事件资料',
                url: 'https://example.com/ymg',
                summary: '这里是网页摘要',
                siteName: '示例站点',
                dateLastCrawled: '2026-04-21',
              },
            ],
          },
        },
      }),
    }) as typeof fetch;

    await expect(
      service.search({
        query: '雁门关事件',
      }),
    ).resolves.toEqual([
      {
        kind: 'web',
        title: '雁门关事件资料',
        url: 'https://example.com/ymg',
        snippet: '这里是网页摘要',
        siteName: '示例站点',
        publishedAt: '2026-04-21',
      },
    ]);
  });

  it('未配置密钥时会直接跳过联网补充', async () => {
    process.env.BOCHA_API_KEY = '';
    const service = new WebFallbackService();

    global.fetch = jest.fn() as typeof fetch;

    await expect(
      service.search({
        query: '雁门关事件',
      }),
    ).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
