import { KnowledgeBaseService } from './knowledge-base.service';
describe('KnowledgeBaseService', () => {
  const kbId = '11111111-1111-4111-8111-111111111111';
  let kbRepo: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mountRepo: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let service: KnowledgeBaseService;

  beforeEach(() => {
    kbRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => ({ id: kbId, ...payload })),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    mountRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
      create: jest.fn((payload) => payload),
      delete: jest.fn(),
    };
    service = new KnowledgeBaseService(kbRepo as never, mountRepo as never);
  });

  it('创建知识库时补齐 hybrid 检索配置默认值', async () => {
    const result = await service.create({
      name: 'Hybrid KB',
      retrievalConfig: {
        retrievalMode: 'hybrid',
        vectorTopK: 12,
        keywordTopK: 8,
        fusion: { rrfK: 80 },
      },
    });

    expect(result.retrievalConfig).toEqual({
      retrievalMode: 'hybrid',
      threshold: 0.6,
      stage1TopK: 12,
      vectorTopK: 12,
      keywordTopK: 8,
      finalTopK: 5,
      rerank: true,
      fusion: {
        method: 'rrf',
        rrfK: 80,
        vectorWeight: 1,
        keywordWeight: 1,
      },
    });
  });

  it('更新旧配置时保留已有值并深合并 fusion', async () => {
    kbRepo.findOneBy.mockResolvedValue({
      id: kbId,
      name: '旧知识库',
      description: null,
      ownerPersonaId: null,
      retrievalConfig: {
        threshold: 0.42,
        stage1TopK: 14,
        finalTopK: 4,
        rerank: false,
      },
    });

    const result = await service.update(kbId, {
      retrievalConfig: {
        vectorTopK: 18,
        fusion: { keywordWeight: 2 },
      },
    });

    expect(result.retrievalConfig).toMatchObject({
      retrievalMode: 'vector',
      threshold: 0.42,
      stage1TopK: 18,
      vectorTopK: 18,
      keywordTopK: 20,
      finalTopK: 4,
      rerank: false,
      fusion: {
        method: 'rrf',
        rrfK: 60,
        vectorWeight: 1,
        keywordWeight: 2,
      },
    });
  });
});
