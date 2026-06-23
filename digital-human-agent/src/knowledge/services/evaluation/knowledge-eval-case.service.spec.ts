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

  let service: KnowledgeEvalCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KnowledgeEvalCaseService(repo as never);
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
});
