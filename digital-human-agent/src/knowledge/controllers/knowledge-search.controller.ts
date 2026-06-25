import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { KnowledgeSearchDto } from '@/knowledge/dto/knowledge-search.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

/**
 * 知识检索控制器。
 *
 * 整合单知识库和 persona 聚合检索的所有搜索端点，
 * 归属于 KnowledgeRetrievalModule，避免 Base ↔ Retrieval 循环依赖。
 */
@ApiTags('knowledge-search')
@Controller()
@UseGuards(JwtAuthGuard)
export class KnowledgeSearchController {
  constructor(
    private readonly searchService: KnowledgeSearchService,
  ) {}

  // ==========================================
  // 单知识库命中测试
  // ==========================================

  @Post('knowledge-bases/:knowledgeId/search')
  @ApiOperation({ summary: '命中测试（混合检索召回 + 重排，单 KB）' })
  search(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Body() body: KnowledgeSearchDto,
    @Req() req: any,
  ) {
    return this.searchService.retrieveWithDebug(
      knowledgeId,
      body.query,
      {
        ...body.toRetrieveOptions(),
        accessScope: this.accessScope(req),
      },
    );
  }

  // ==========================================
  // Persona 聚合检索
  // ==========================================

  @Post('personas/:personaId/search')
  @ApiOperation({
    summary: 'persona 聚合命中测试（并查所有挂载 KB + 合并 + 全局 rerank）',
  })
  async searchForPersona(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
    @Req() req: any,
  ) {
    const normalizedQuery = String(body.query ?? '').trim();
    const results = await this.searchService.retrieveForPersona(
      personaId,
      normalizedQuery,
      {
        ...body.toRetrieveOptions(),
        accessScope: this.accessScope(req),
      },
    );
    return { query: normalizedQuery, results };
  }

  @Post(['personas/:personaId/search/stages', 'personas/:personaId/search/debug'])
  @ApiOperation({
    summary: 'persona 聚合命中测试（返回 query rewrite、召回、重排与 trace）',
  })
  async searchForPersonaWithDebug(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() body: KnowledgeSearchDto,
    @Req() req: any,
  ) {
    const normalizedQuery = String(body.query ?? '').trim();
    return this.searchService.retrieveForPersonaWithDebug(
      personaId,
      normalizedQuery,
      {
        ...body.toRetrieveOptions(),
        accessScope: this.accessScope(req),
      },
    );
  }

  private accessScope(req: any): KnowledgeAccessScope {
    return {
      ownerId: req.user?.id ?? null,
      department: req.user?.department ?? null,
      role: req.user?.role ?? null,
    };
  }
}
