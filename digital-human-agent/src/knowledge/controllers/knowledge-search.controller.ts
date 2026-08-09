import {
  Body,
  Controller,
  Get,
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
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';
import {
  createRetrievalStrategyPreset,
  type RetrievalPreset,
} from '@/common/rag';

/**
 * 知识检索控制器。
 *
 * 整合单知识库和 persona 聚合检索的所有搜索端点，
 * 归属于 KnowledgeRetrievalModule，避免 Base ↔ Retrieval 循环依赖。
 */
@ApiTags('knowledge-search')
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('search:view')
export class KnowledgeSearchController {
  constructor(
    private readonly searchService: KnowledgeSearchService,
  ) {}

  // ==========================================
  // 单知识库命中测试
  // ==========================================

  @Get('retrieval-strategies/presets')
  @ApiOperation({ summary: '查询可用检索策略预设' })
  listRetrievalStrategyPresets() {
    // 注意：memory_aware / multimodal 预设目前只有布尔开关，没有独立的
    // memory / multimodal 检索通道实现（RAG 管线实际只有 vector/keyword/graph），
    // 对外暴露会误导使用者，故不列入公开预设列表
    const presets: RetrievalPreset[] = [
      'precise',
      'balanced',
      'broad',
      'graph_first',
    ];
    return {
      presets: presets.map((name) => ({
        name,
        strategy: createRetrievalStrategyPreset(name),
      })),
    };
  }

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

  @Post('search')
  @ApiOperation({ summary: '跨知识库资料检索（混合召回 + RRF + Rerank + 权限过滤）' })
  searchAcrossKnowledgeBases(
    @Body() body: KnowledgeSearchDto,
    @Req() req: any,
  ) {
    return this.searchService.retrieveAcrossKnowledgeBasesWithDebug(
      String(body.query ?? '').trim(),
      body.knowledgeBaseIds ?? [],
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
