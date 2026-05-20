import { ConfigService } from '@nestjs/config';
import { KnowledgeContentRuntimeService } from '@/knowledge/services/manage/knowledge-content-runtime.service';

describe('KnowledgeContentRuntimeService', () => {
  it('normalizeRetrieveOptions 会保留 skipQueryRewrite 观测字段', () => {
    const mockConfigService = {
      get: jest.fn(),
    } as unknown as ConfigService;
    const service = new KnowledgeContentRuntimeService({} as never, mockConfigService);

    expect(
      service.normalizeRetrieveOptions({
        skipQueryRewrite: true,
      }).skipQueryRewrite,
    ).toBe(true);

    expect(service.normalizeRetrieveOptions({}).skipQueryRewrite).toBe(false);
  });
});

