import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/manage/knowledge-content-runtime.service';

describe('KnowledgeContentRuntimeService', () => {
  it('normalizeRetrieveOptions 会保留 skipQueryRewrite 观测字段', () => {
    const service = new KnowledgeContentRuntimeService({} as never);

    expect(
      service.normalizeRetrieveOptions({
        skipQueryRewrite: true,
      }).skipQueryRewrite,
    ).toBe(true);

    expect(service.normalizeRetrieveOptions({}).skipQueryRewrite).toBe(false);
  });
});
