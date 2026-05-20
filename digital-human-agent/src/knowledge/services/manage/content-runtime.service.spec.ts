import { ConfigService } from '@nestjs/config';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';

describe('ContentRuntimeService', () => {
  it('normalizeRetrieveOptions 会保留 skipQueryRewrite 观测字段', () => {
    const mockConfigService = {
      get: jest.fn(),
    } as unknown as ConfigService;
    const service = new ContentRuntimeService({} as never, mockConfigService);

    expect(
      service.normalizeRetrieveOptions({
        skipQueryRewrite: true,
      }).skipQueryRewrite,
    ).toBe(true);

    expect(service.normalizeRetrieveOptions({}).skipQueryRewrite).toBe(false);
  });
});
