import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttachKnowledgeDto } from '@/knowledge/dto/attach-knowledge.dto';
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { KnowledgeSearchDto } from '@/knowledge/dto/knowledge-search.dto';

@ApiTags('persona-knowledge-bases')
@Controller('personas/:personaId')
export class PersonaKnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly searchService: KnowledgeSearchService,
  ) {}

  @Get('knowledge-bases')
  @ApiOperation({ summary: '列出 persona 已挂载的知识库' })
  listMounted(@Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.knowledgeService.listForPersona(personaId);
  }

  @Post('knowledge-bases')
  @ApiOperation({ summary: '挂载知识库到 persona' })
  async attach(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() dto: AttachKnowledgeDto,
  ) {
    await this.knowledgeService.attachPersona(personaId, dto.knowledgeBaseId);
    return {
      personaId,
      knowledgeBaseId: dto.knowledgeBaseId,
      attached: true,
    };
  }

  @Delete('knowledge-bases/:knowledgeId')
  @ApiOperation({ summary: '解除挂载' })
  async detach(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
  ) {
    await this.knowledgeService.detachPersona(personaId, knowledgeId);
    return { personaId, knowledgeBaseId: knowledgeId, attached: false };
  }

  @Post('search')
  @ApiOperation({
    summary: 'persona 聚合命中测试（并查所有挂载 KB + 合并 + 全局 rerank）',
  })
  async search(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    const normalizedQuery = String(body.query ?? '').trim();
    const results = await this.searchService.retrieveForPersona(
      personaId,
      normalizedQuery,
      {
        rerank: body.rerank,
        threshold: body.threshold,
        retrievalLimit: body.retrievalLimit ?? body.stage1TopK,
        rerankLimit: body.rerankLimit ?? body.finalTopK,
      },
    );
    return { query: normalizedQuery, results };
  }

  @Post(['search/stages', 'search/debug'])
  @ApiOperation({
    summary: 'persona 聚合命中测试（返回 query rewrite、召回、重排与 trace）',
  })
  async searchWithDebug(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    const normalizedQuery = String(body.query ?? '').trim();
    return this.searchService.retrieveForPersonaWithDebug(
      personaId,
      normalizedQuery,
      {
        rerank: body.rerank,
        threshold: body.threshold,
        retrievalLimit: body.retrievalLimit ?? body.stage1TopK,
        rerankLimit: body.rerankLimit ?? body.finalTopK,
      },
    );
  }
}
