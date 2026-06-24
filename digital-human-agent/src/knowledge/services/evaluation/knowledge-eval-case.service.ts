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
import { PersonaKnowledge } from '@/knowledge/entities/persona-knowledge.entity';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';

@Injectable()
export class KnowledgeEvalCaseService {
  constructor(
    @InjectRepository(KnowledgeEvalCase)
    private readonly evalCaseRepo: Repository<KnowledgeEvalCase>,
    @InjectRepository(PersonaKnowledge)
    private readonly personaKbRepo: Repository<PersonaKnowledge>,
    private readonly searchService: KnowledgeSearchService,
    private readonly llmFactory: LlmFactoryService,
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

  async runBatchEvaluation(knowledgeId: string): Promise<KnowledgeEvalCase[]> {
    const cases = await this.listByKnowledge(knowledgeId);
    if (cases.length === 0) {
      return [];
    }

    const association = await this.personaKbRepo.findOne({
      where: { knowledgeBaseId: knowledgeId },
    });
    const personaId = association?.personaId;
    if (!personaId) {
      throw new BadRequestException('请先为该知识库绑定一个数字人角色以执行问答评测');
    }

    const chatModel = this.llmFactory.createChatModel({ temperature: 0 });

    for (const caseItem of cases) {
      caseItem.lastRunStatus = 'running';
      await this.evalCaseRepo.save(caseItem);

      try {
        const chunks = await this.searchService.retrieveForPersona(
          personaId,
          caseItem.question,
          {},
        );

        const contextText = chunks.map((c) => c.content).join('\n---\n');

        const systemPrompt = `你是一个知识库问答机器人。根据以下提供的背景知识，回答用户的问题。如果背景知识不足以回答，请根据已有知识进行合理推测，或者礼貌指出。

背景知识：
${contextText || '无背景知识'}

用户问题：${caseItem.question}`;

        const qaResponse = await chatModel.invoke([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: caseItem.question },
        ]);
        const actualAnswer = String(qaResponse.content).trim();

        let hitRate = 0;
        if (chunks.length > 0) {
          const hitPrompt = `请评估以下背景知识是否包含解答用户问题所需的信息。
背景知识：
${contextText}

用户问题：${caseItem.question}

若背景知识包含相关答案的线索或信息，请仅回复数字 1，否则回复数字 0。请不要输出任何其他字符。`;
          const hitResponse = await chatModel.invoke([
            { role: 'user', content: hitPrompt },
          ]);
          hitRate = String(hitResponse.content).trim() === '1' ? 1 : 0;
        }

        let recall: number | null = null;
        if (caseItem.expectedAnswer) {
          const recallPrompt = `请比对以下“实际回答”与“期望回答”，并评估实际回答对期望回答关键信息点的覆盖比例。
实际回答：${actualAnswer}
期望回答：${caseItem.expectedAnswer}

请仅输出一个 0.0 到 1.0 之间的浮点数字，代表实际回答覆盖期望回答的比例（例如：如果完全覆盖请输出 1.0，如果毫无关系输出 0.0，若部分覆盖输出 0.5）。请不要包含任何解释或额外文字。`;
          const recallResponse = await chatModel.invoke([
            { role: 'user', content: recallPrompt },
          ]);
          const parsedRecall = parseFloat(String(recallResponse.content).trim());
          recall = isNaN(parsedRecall) ? 0 : Math.min(Math.max(parsedRecall, 0), 1);
        }

        caseItem.lastRunActualAnswer = actualAnswer;
        caseItem.lastRunHitRate = hitRate;
        caseItem.lastRunRecall = recall;
        caseItem.lastRunStatus = 'success';
        caseItem.lastRunError = null;
        caseItem.lastRunAt = new Date();
      } catch (err: any) {
        caseItem.lastRunStatus = 'failed';
        caseItem.lastRunError = err.message || String(err);
        caseItem.lastRunAt = new Date();
      }
      await this.evalCaseRepo.save(caseItem);
    }

    return this.listByKnowledge(knowledgeId);
  }

  async updateReviewStatus(
    knowledgeId: string,
    caseId: string,
    status: 'passed' | 'failed' | 'unreviewed',
  ): Promise<KnowledgeEvalCase> {
    const caseItem = await this.findInKnowledgeOrThrow(knowledgeId, caseId);
    caseItem.userReviewStatus = status;
    return this.evalCaseRepo.save(caseItem);
  }
}
