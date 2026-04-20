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
import { KnowledgeService } from '@/knowledge/knowledge.service';

@ApiTags('persona-knowledge-bases')
@Controller('personas/:personaId')
export class PersonaKnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

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
}
