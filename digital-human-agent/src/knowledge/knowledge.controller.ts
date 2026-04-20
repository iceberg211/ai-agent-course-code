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
import { CreateKnowledgeDto } from '@/knowledge/dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from '@/knowledge/dto/update-knowledge.dto';
import { KnowledgeService } from '@/knowledge/knowledge.service';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  listAll() {
    return this.knowledgeService.listAll();
  }

  @Post()
  create(@Body() dto: CreateKnowledgeDto) {
    return this.knowledgeService.create(dto);
  }

  @Get(':knowledgeId')
  findOne(@Param('knowledgeId', ParseUUIDPipe) knowledgeId: string) {
    return this.knowledgeService.findOne(knowledgeId);
  }

  @Patch(':knowledgeId')
  update(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Body() dto: UpdateKnowledgeDto,
  ) {
    return this.knowledgeService.update(knowledgeId, dto);
  }

  @Delete(':knowledgeId')
  @ApiOperation({ summary: '删除知识库（级联文档 + chunks）' })
  remove(@Param('knowledgeId', ParseUUIDPipe) knowledgeId: string) {
    return this.knowledgeService.remove(knowledgeId);
  }
}
