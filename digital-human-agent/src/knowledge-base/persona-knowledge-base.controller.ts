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
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeSearchDto } from '../knowledge/api/dto/knowledge-search.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { AttachKnowledgeBaseDto } from './dto/attach-knowledge-base.dto';

@ApiTags('persona-knowledge-bases')
@Controller('personas/:personaId')
export class PersonaKnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  @Get('knowledge-bases')
  @ApiOperation({ summary: '列出 persona 已挂载的知识库' })
  listMounted(@Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.kbService.listKbsForPersona(personaId);
  }

  @Post('knowledge-bases')
  @ApiOperation({ summary: '挂载知识库到 persona' })
  async attach(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() dto: AttachKnowledgeBaseDto,
  ) {
    await this.kbService.attachPersona(personaId, dto.knowledgeBaseId);
    return { personaId, knowledgeBaseId: dto.knowledgeBaseId, attached: true };
  }

  @Delete('knowledge-bases/:kbId')
  @ApiOperation({ summary: '解除挂载' })
  async detach(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
  ) {
    await this.kbService.detachPersona(personaId, kbId);
    return { personaId, knowledgeBaseId: kbId, attached: false };
  }

  @Post('search')
  @ApiOperation({
    summary: 'persona 聚合命中测试（并查所有挂载 KB + 合并 + 全局 rerank）',
  })
  async search(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    const result = await this.knowledgeService.retrieveForPersonaWithTrace(
      personaId,
      String(body.query ?? ''),
      {
        retrievalMode: body.retrievalMode,
        rerank: body.rerank,
        threshold: body.threshold,
        stage1TopK: body.stage1TopK,
        vectorTopK: body.vectorTopK,
        keywordTopK: body.keywordTopK,
        candidateLimit: body.candidateLimit,
        finalTopK: body.finalTopK,
        fusion: body.fusion,
        rewrite: body.rewrite,
        history: body.history,
      },
    );
    return result;
  }
}
