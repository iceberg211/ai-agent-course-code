import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KnowledgeSearchDto } from '@/knowledge-content/dto/knowledge-search.dto';
import { KnowledgeContentService } from '@/knowledge-content/services/knowledge-content.service';

@ApiTags('knowledge-content')
@Controller('personas/:personaId')
export class PersonaKnowledgeSearchController {
  constructor(
    private readonly knowledgeContentService: KnowledgeContentService,
  ) {}

  @Post('search')
  @ApiOperation({
    summary: 'persona 聚合命中测试（并查所有挂载 KB + 合并 + 全局 rerank）',
  })
  async search(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    const normalizedQuery = String(body.query ?? '').trim();
    const results = await this.knowledgeContentService.retrieveForPersona(
      personaId,
      normalizedQuery,
    );
    return { query: normalizedQuery, results };
  }
}
