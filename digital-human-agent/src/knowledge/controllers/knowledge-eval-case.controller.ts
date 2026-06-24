import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { CreateEvalCaseDto } from '@/knowledge/dto/create-eval-case.dto';
import { UpdateEvalCaseDto } from '@/knowledge/dto/update-eval-case.dto';
import { KnowledgeEvalCaseService } from '@/knowledge/services/evaluation/knowledge-eval-case.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

export class UpdateReviewStatusDto {
  @IsNotEmpty({ message: '状态不能为空' })
  @IsIn(['passed', 'failed', 'unreviewed'], { message: '审核状态必须为 passed、failed 或 unreviewed' })
  status: 'passed' | 'failed' | 'unreviewed';
}

@ApiTags('knowledge-eval-cases')
@Controller('knowledge-bases/:knowledgeId/eval-cases')
@UseGuards(JwtAuthGuard)
export class KnowledgeEvalCaseController {
  constructor(private readonly evalCaseService: KnowledgeEvalCaseService) {}

  @Get()
  @ApiOperation({ summary: '列出知识库问答验证用例' })
  list(@Param('knowledgeId', ParseUUIDPipe) knowledgeId: string) {
    return this.evalCaseService.listByKnowledge(knowledgeId);
  }

  @Post()
  @ApiOperation({ summary: '保存问答验证用例' })
  create(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Body() dto: CreateEvalCaseDto,
  ) {
    return this.evalCaseService.create(knowledgeId, dto);
  }

  @Patch(':evalCaseId')
  @ApiOperation({ summary: '更新问答验证用例' })
  update(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Param('evalCaseId', ParseUUIDPipe) evalCaseId: string,
    @Body() dto: UpdateEvalCaseDto,
  ) {
    return this.evalCaseService.update(knowledgeId, evalCaseId, dto);
  }

  @Delete(':evalCaseId')
  @ApiOperation({ summary: '删除问答验证用例' })
  async remove(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Param('evalCaseId', ParseUUIDPipe) evalCaseId: string,
  ) {
    await this.evalCaseService.remove(knowledgeId, evalCaseId);
    return { deleted: true };
  }

  @Post('run-batch')
  @ApiOperation({ summary: '批量运行并评估问答验证用例' })
  runBatch(@Param('knowledgeId', ParseUUIDPipe) knowledgeId: string) {
    return this.evalCaseService.runBatchEvaluation(knowledgeId);
  }

  @Patch(':evalCaseId/review')
  @ApiOperation({ summary: '人工审核评估用例结果' })
  updateReview(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Param('evalCaseId', ParseUUIDPipe) evalCaseId: string,
    @Body() dto: UpdateReviewStatusDto,
  ) {
    return this.evalCaseService.updateReviewStatus(knowledgeId, evalCaseId, dto.status);
  }
}
