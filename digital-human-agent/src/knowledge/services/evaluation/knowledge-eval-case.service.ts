import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEvalCaseDto } from '@/knowledge/dto/create-eval-case.dto';
import { UpdateEvalCaseDto } from '@/knowledge/dto/update-eval-case.dto';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';

@Injectable()
export class KnowledgeEvalCaseService {
  constructor(
    @InjectRepository(KnowledgeEvalCase)
    private readonly evalCaseRepo: Repository<KnowledgeEvalCase>,
  ) {}

  listByKnowledge(knowledgeId: string): Promise<KnowledgeEvalCase[]> {
    return this.evalCaseRepo.find({
      where: { knowledgeBaseId: knowledgeId },
      order: { createdAt: 'DESC' },
    });
  }

  create(
    knowledgeId: string,
    dto: CreateEvalCaseDto,
  ): Promise<KnowledgeEvalCase> {
    const question = this.normalizeQuestion(dto.question);
    return this.evalCaseRepo.save(
      this.evalCaseRepo.create({
        knowledgeBaseId: knowledgeId,
        question,
        expectedAnswer: dto.expectedAnswer?.trim() || null,
      }),
    );
  }

  async update(
    knowledgeId: string,
    evalCaseId: string,
    dto: UpdateEvalCaseDto,
  ): Promise<KnowledgeEvalCase> {
    const evalCase = await this.findInKnowledgeOrThrow(knowledgeId, evalCaseId);
    if (dto.question !== undefined) {
      evalCase.question = this.normalizeQuestion(dto.question);
    }
    if (dto.expectedAnswer !== undefined) {
      evalCase.expectedAnswer = dto.expectedAnswer.trim() || null;
    }
    return this.evalCaseRepo.save(evalCase);
  }

  async remove(knowledgeId: string, evalCaseId: string): Promise<void> {
    const evalCase = await this.findInKnowledgeOrThrow(knowledgeId, evalCaseId);
    await this.evalCaseRepo.remove(evalCase);
  }

  private async findInKnowledgeOrThrow(
    knowledgeId: string,
    evalCaseId: string,
  ): Promise<KnowledgeEvalCase> {
    const evalCase = await this.evalCaseRepo.findOne({
      where: { id: evalCaseId, knowledgeBaseId: knowledgeId },
    });
    if (!evalCase) {
      throw new NotFoundException('验证用例不存在或不属于当前知识库');
    }
    return evalCase;
  }

  private normalizeQuestion(question: string): string {
    const value = question.trim();
    if (!value) {
      throw new BadRequestException('验证问题不能为空');
    }
    return value;
  }
}
