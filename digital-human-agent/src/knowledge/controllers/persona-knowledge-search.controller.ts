import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KnowledgeSearchDto } from '@/knowledge/dto/knowledge-search.dto';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';

@ApiTags('knowledge-content')
@Controller('personas/:personaId')
export class PersonaKnowledgeSearchController {
  constructor(
    private readonly searchService: KnowledgeSearchService,
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

  @Post('search/stages')
  @ApiOperation({
    summary: 'persona 聚合命中测试（返回 query rewrite、召回、重排与 trace）',
  })
  async searchWithStages(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    const normalizedQuery = String(body.query ?? '').trim();
    return this.searchService.retrieveForPersonaWithStages(
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
