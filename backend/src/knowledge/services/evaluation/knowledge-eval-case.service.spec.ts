import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';
import { KnowledgeEvalCaseService } from './knowledge-eval-case.service';

describe('KnowledgeEvalCaseService', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => ({ id: 'case-1', ...input })),
    remove: jest.fn(),
  };

  const personaKbRepo = {
    findOne: jest.fn(),
  };
  const searchService = {
    retrieveForPersona: jest.fn(),
  };
  const mockChatModel = {
    invoke: jest.fn(),
  };
  const llmFactory = {
    createChatModel: jest.fn().mockReturnValue(mockChatModel),
  };

  let service: KnowledgeEvalCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KnowledgeEvalCaseService(
      repo as never,
      personaKbRepo as never,
      searchService as never,
      llmFactory as never,
    );
  });

  it('保存验证用例时会清理问题和期望答案', async () => {
    const saved = await service.create('kb-1', {
      question: '  如何申请差旅报销？ ',
      expectedAnswer: '  需要提交发票和审批单  ',
    });

    expect(repo.create).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      question: '如何申请差旅报销？',
      expectedAnswer: '需要提交发票和审批单',
    });
    expect(saved.question).toBe('如何申请差旅报销？');
  });

  it('拒绝空验证问题', async () => {
    expect(() => service.create('kb-1', { question: '   ' })).toThrow(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('删除前校验用例属于当前知识库', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.remove('kb-1', 'case-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('可以更新期望答案为空', async () => {
    const evalCase = {
      id: 'case-1',
      knowledgeBaseId: 'kb-1',
      question: '原问题',
      expectedAnswer: '原答案',
    } as KnowledgeEvalCase;
    repo.findOne.mockResolvedValue(evalCase);

    const saved = await service.update('kb-1', 'case-1', {
      expectedAnswer: '  ',
    });

    expect(saved.expectedAnswer).toBeNull();
    expect(repo.save).toHaveBeenCalledWith({
      ...evalCase,
      expectedAnswer: null,
    });
  });

  describe('runBatchEvaluation', () => {
    it('若无测试用例则直接返回空数组', async () => {
      repo.find.mockResolvedValue([]);
      const result = await service.runBatchEvaluation('kb-1');
      expect(result).toEqual([]);
      expect(personaKbRepo.findOne).not.toHaveBeenCalled();
    });

    it('若未绑定 Persona 角色则抛出异常', async () => {
      repo.find.mockResolvedValue([{ id: 'case-1', question: 'hello' }]);
      personaKbRepo.findOne.mockResolvedValue(null);

      await expect(service.runBatchEvaluation('kb-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('能正确运行评估流程并计算命中率和覆盖率', async () => {
      const caseItem = {
        id: 'case-1',
        question: '如何请假？',
        expectedAnswer: '需要提交申请',
        lastRunStatus: 'unrun',
      } as KnowledgeEvalCase;

      repo.find.mockResolvedValue([caseItem]);
      personaKbRepo.findOne.mockResolvedValue({ personaId: 'persona-1' });
      searchService.retrieveForPersona.mockResolvedValue([
        { content: '请假流程：提交请假单即可。' },
      ]);

      mockChatModel.invoke
        .mockResolvedValueOnce({ content: '实际的请假回答' })
        .mockResolvedValueOnce({ content: '1' })
        .mockResolvedValueOnce({ content: '0.8' });

      // 因为 runBatchEvaluation 内部会 find 再返回列表，我们让再次调用 find 返回已更新的 caseItem
      repo.find.mockResolvedValue([caseItem]);

      const result = await service.runBatchEvaluation('kb-1');

      expect(searchService.retrieveForPersona).toHaveBeenCalledWith(
        'persona-1',
        '如何请假？',
        {},
      );
      expect(repo.save).toHaveBeenCalled();
      expect(caseItem.lastRunStatus).toBe('success');
      expect(caseItem.lastRunActualAnswer).toBe('实际的请假回答');
      expect(caseItem.lastRunHitRate).toBe(1);
      expect(caseItem.lastRunRecall).toBe(0.8);
      expect(result).toHaveLength(1);
    });
  });

  describe('updateReviewStatus', () => {
    it('能正确更新审核状态', async () => {
      const evalCase = {
        id: 'case-1',
        knowledgeBaseId: 'kb-1',
        userReviewStatus: 'unreviewed',
      } as KnowledgeEvalCase;
      repo.findOne.mockResolvedValue(evalCase);

      const saved = await service.updateReviewStatus('kb-1', 'case-1', 'passed');
      expect(saved.userReviewStatus).toBe('passed');
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ userReviewStatus: 'passed' }));
    });
  });
});
