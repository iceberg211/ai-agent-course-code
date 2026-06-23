import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateEvalCaseDto } from '@/knowledge/dto/create-eval-case.dto';
import { UpdateEvalCaseDto } from '@/knowledge/dto/update-eval-case.dto';
import { KnowledgeEvalCaseService } from '@/knowledge/services/evaluation/knowledge-eval-case.service';

@ApiTags('knowledge-eval-cases')
@Controller('knowledge-bases/:knowledgeId/eval-cases')
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
}
