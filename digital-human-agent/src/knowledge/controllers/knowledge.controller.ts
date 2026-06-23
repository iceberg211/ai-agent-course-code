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
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { KnowledgeSearchDto } from '@/knowledge/dto/knowledge-search.dto';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly searchService: KnowledgeSearchService,
  ) {}

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

  @Post(':knowledgeId/search')
  @ApiOperation({ summary: '命中测试（混合检索召回 + 重排，单 KB）' })
  search(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    return this.searchService.retrieveWithDebug(knowledgeId, body.query, {
      rerank: body.rerank,
      threshold: body.threshold,
      retrievalLimit: body.retrievalLimit ?? body.stage1TopK,
      rerankLimit: body.rerankLimit ?? body.finalTopK,
    });
  }
}
