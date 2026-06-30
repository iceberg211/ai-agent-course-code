import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEvalCaseDto } from '@/knowledge/dto/create-eval-case.dto';
import { UpdateEvalCaseDto } from '@/knowledge/dto/update-eval-case.dto';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';
import { PersonaKnowledge } from '@/knowledge/entities/persona-knowledge.entity';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';
import { NotificationService } from '@/notification/notification.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

export interface KnowledgeEvalMetricsSummary {
  total: number;
  success: number;
  failed: number;
  reviewedPassed: number;
  reviewedFailed: number;
  hitAt1: number | null;
  hitAt3: number | null;
  recallAt5: number | null;
  recallAt10: number | null;
  avgRetrievalLatencyMs: number | null;
  avgRerankLatencyMs: number | null;
}

@Injectable()
export class KnowledgeEvalCaseService {
  constructor(
    @InjectRepository(KnowledgeEvalCase)
    private readonly evalCaseRepo: Repository<KnowledgeEvalCase>,
    @InjectRepository(PersonaKnowledge)
    private readonly personaKbRepo: Repository<PersonaKnowledge>,
    private readonly searchService: KnowledgeSearchService,
    private readonly llmFactory: LlmFactoryService,
    @Optional()
    private readonly notificationService?: NotificationService,
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
        const retrievalStartedAt = Date.now();
        const debugResult =
          typeof this.searchService.retrieveForPersonaWithDebug === 'function'
            ? await this.searchService.retrieveForPersonaWithDebug(
                personaId,
                caseItem.question,
                {},
              )
            : null;
        const chunks =
          debugResult?.rerankedChunks ??
          (await this.searchService.retrieveForPersona(
            personaId,
            caseItem.question,
            {},
          ));
        const retrievalLatencyMs = Date.now() - retrievalStartedAt;

        const contextText = chunks.map((c) => c.content).join('\n---\n');

        const systemPrompt = `你是一个知识库问答机器人。只能根据以下提供的背景知识回答用户的问题。如果背景知识不足以回答，必须明确说明无法从当前知识库证据确认，不要编造或推测。

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
        caseItem.lastRunHitAt1 = this.calculateHitAtK(caseItem, chunks, 1);
        caseItem.lastRunHitAt3 = this.calculateHitAtK(caseItem, chunks, 3);
        caseItem.lastRunRecallAt5 = this.calculateRecallAtK(caseItem, chunks, 5);
        caseItem.lastRunRecallAt10 = this.calculateRecallAtK(caseItem, chunks, 10);
        caseItem.lastRunRetrievalLatencyMs = retrievalLatencyMs;
        caseItem.lastRunRerankLatencyMs =
          debugResult?.stageTrace?.rerank?.length ? null : 0;
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

    const result = await this.listByKnowledge(knowledgeId);
    void this.notificationService?.create({
      type: 'eval_batch_completed',
      title: '问答验证批量运行完成',
      message: `知识库验证用例已完成运行，共 ${result.length} 条`,
      payload: {
        knowledgeId,
        total: result.length,
        failed: result.filter((item) => item.lastRunStatus === 'failed').length,
      },
    });
    return result;
  }

  async getMetricsSummary(
    knowledgeId: string,
  ): Promise<KnowledgeEvalMetricsSummary> {
    const cases = await this.listByKnowledge(knowledgeId);
    const successCases = cases.filter((item) => item.lastRunStatus === 'success');
    return {
      total: cases.length,
      success: successCases.length,
      failed: cases.filter((item) => item.lastRunStatus === 'failed').length,
      reviewedPassed: cases.filter((item) => item.userReviewStatus === 'passed').length,
      reviewedFailed: cases.filter((item) => item.userReviewStatus === 'failed').length,
      hitAt1: this.average(successCases.map((item) => item.lastRunHitAt1)),
      hitAt3: this.average(successCases.map((item) => item.lastRunHitAt3)),
      recallAt5: this.average(successCases.map((item) => item.lastRunRecallAt5)),
      recallAt10: this.average(successCases.map((item) => item.lastRunRecallAt10)),
      avgRetrievalLatencyMs: this.average(
        successCases.map((item) => item.lastRunRetrievalLatencyMs),
      ),
      avgRerankLatencyMs: this.average(
        successCases.map((item) => item.lastRunRerankLatencyMs),
      ),
    };
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

  private calculateHitAtK(
    caseItem: KnowledgeEvalCase,
    chunks: KnowledgeChunk[],
    topK: number,
  ): number {
    if (chunks.length === 0) return 0;
    if (!caseItem.expectedAnswer) {
      return chunks.slice(0, topK).length > 0 ? 1 : 0;
    }
    const recall = this.calculateRecallAtK(caseItem, chunks, topK);
    return (recall ?? 0) >= 0.35 ? 1 : 0;
  }

  private calculateRecallAtK(
    caseItem: KnowledgeEvalCase,
    chunks: KnowledgeChunk[],
    topK: number,
  ): number | null {
    if (!caseItem.expectedAnswer) return null;
    const expectedTokens = this.extractComparableTokens(caseItem.expectedAnswer);
    if (expectedTokens.length === 0) return null;
    const contextTokens = new Set(
      this.extractComparableTokens(
        chunks
          .slice(0, topK)
          .map((chunk) => chunk.content)
          .join('\n'),
      ),
    );
    const matched = expectedTokens.filter((token) => contextTokens.has(token));
    return matched.length / expectedTokens.length;
  }

  private extractComparableTokens(text: string): string[] {
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
    return Array.from(new Set(Array.from(normalized)));
  }

  private average(values: Array<number | null | undefined>): number | null {
    const valid = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    if (valid.length === 0) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }
}
