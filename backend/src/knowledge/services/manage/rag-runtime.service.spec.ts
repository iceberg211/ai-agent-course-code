import { ConfigService } from '@nestjs/config';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';

describe('RagRuntimeService', () => {
  it('normalizeRetrieveOptions 会保留 skipQueryRewrite 观测字段', () => {
    const mockConfigService = {
      get: jest.fn(),
    } as unknown as ConfigService;
    const service = new RagRuntimeService({} as never, mockConfigService);

    expect(
      service.normalizeRetrieveOptions({
        skipQueryRewrite: true,
      }).skipQueryRewrite,
    ).toBe(true);

    expect(service.normalizeRetrieveOptions({}).skipQueryRewrite).toBe(false);
  });
});
