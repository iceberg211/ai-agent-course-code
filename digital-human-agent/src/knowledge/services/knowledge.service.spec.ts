import { KnowledgeService } from './knowledge.service';
import { CreateKnowledgeDto } from '@/knowledge/dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from '@/knowledge/dto/update-knowledge.dto';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';

describe('KnowledgeService', () => {
  const knowledgeRepo = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => ({ id: 'kb-1', ...input })),
    delete: jest.fn(),
  };

  const personaKnowledgeRepo = {
    find: jest.fn(),
    create: jest.fn((input) => input),
    save: jest.fn(),
    delete: jest.fn(),
  };

  let service: KnowledgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KnowledgeService(
      knowledgeRepo as never,
      personaKnowledgeRepo as never,
    );
  });

  describe('create', () => {
    it('若不传 preset 和 config，则使用默认的检索配置', async () => {
      const dto: CreateKnowledgeDto = {
        name: '测试库',
      };

      await service.create(dto);

      expect(knowledgeRepo.create).toHaveBeenCalledWith({
        name: '测试库',
        description: null,
        ownerPersonaId: null,
        retrievalConfig: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG,
      });
    });

    it('传入 preset: broad 时，能正确映射并使用宽泛预设配置', async () => {
      const dto: CreateKnowledgeDto = {
        name: '测试库',
        preset: 'broad',
      };

      await service.create(dto);

      expect(knowledgeRepo.create).toHaveBeenCalledWith({
        name: '测试库',
        description: null,
        ownerPersonaId: null,
        retrievalConfig: {
          threshold: 0.3,
          retrievalLimit: 40,
          rerankLimit: 10,
          rerank: true,
        },
      });
    });

    it('同时传入 preset: broad 和自定义的 retrievalConfig 时，自定义参数会覆盖预设值', async () => {
      const dto: CreateKnowledgeDto = {
        name: '测试库',
        preset: 'broad',
        retrievalConfig: {
          threshold: 0.9, // 覆盖预设的 0.3
        },
      };

      await service.create(dto);

      expect(knowledgeRepo.create).toHaveBeenCalledWith({
        name: '测试库',
        description: null,
        ownerPersonaId: null,
        retrievalConfig: {
          threshold: 0.9,
          retrievalLimit: 40,
          rerankLimit: 10,
          rerank: true,
        },
      });
    });
  });

  describe('update', () => {
    it('可以通过 preset 变更原有检索配置', async () => {
      const originalKnowledge = {
        id: 'kb-1',
        name: '旧名称',
        retrievalConfig: {
          threshold: 0.6,
          retrievalLimit: 20,
          rerankLimit: 5,
          rerank: true,
        },
      };
      knowledgeRepo.findOneBy.mockResolvedValue(originalKnowledge);

      const dto: UpdateKnowledgeDto = {
        preset: 'precise',
      };

      const result = await service.update('kb-1', dto);

      expect(result.retrievalConfig).toEqual({
        threshold: 0.7,
        retrievalLimit: 20,
        rerankLimit: 5,
        rerank: true,
      });
    });

    it('混合 preset 与自定义参数更新时能完美覆盖融合', async () => {
      const originalKnowledge = {
        id: 'kb-1',
        name: '旧名称',
        retrievalConfig: {
          threshold: 0.6,
          retrievalLimit: 20,
          rerankLimit: 5,
          rerank: true,
        },
      };
      knowledgeRepo.findOneBy.mockResolvedValue(originalKnowledge);

      const dto: UpdateKnowledgeDto = {
        preset: 'broad',
        retrievalConfig: {
          retrievalLimit: 45, // 覆盖 broad 预设的 40
        },
      };

      const result = await service.update('kb-1', dto);

      expect(result.retrievalConfig).toEqual({
        threshold: 0.3,
        retrievalLimit: 45,
        rerankLimit: 10,
        rerank: true,
      });
    });
  });
});
