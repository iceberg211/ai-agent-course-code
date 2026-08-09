import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateKnowledgeDto } from '@/knowledge/dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from '@/knowledge/dto/update-knowledge.dto';
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';
import {
  KnowledgeGraphListEntitiesQueryDto,
  KnowledgeGraphListRelationsQueryDto,
  KnowledgeGraphNeighborhoodQueryDto,
  KnowledgeGraphOverviewQueryDto,
} from '@/knowledge/dto/knowledge-graph-query.dto';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly graphService: KnowledgeGraphService,
  ) {}

  @Get()
  listAll() {
    return this.knowledgeService.listAll();
  }

  @Get('presets')
  @ApiOperation({ summary: '获取可用的 RAG 检索预设模板' })
  getPresets() {
    return {
      presets: [
        {
          preset: 'precise',
          name: '精确模式',
          description: '卡高相似度分数，适合专业 FAQ 问答，回答严格匹配背景知识。',
          config: {
            threshold: 0.7,
            retrievalLimit: 20,
            rerankLimit: 5,
            rerank: true,
          },
        },
        {
          preset: 'balanced',
          name: '均衡模式',
          description: '兼顾召回广度与命中精度，适用于绝大部分普通问答场景。',
          config: {
            threshold: 0.6,
            retrievalLimit: 20,
            rerankLimit: 5,
            rerank: true,
          },
        },
        {
          preset: 'broad',
          name: '宽泛模式',
          description: '放低相关度阈值以召回更多候选切片，适合长文档检索和泛化阅读。',
          config: {
            threshold: 0.3,
            retrievalLimit: 40,
            rerankLimit: 10,
            rerank: true,
          },
        },
      ],
    };
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

  @Get(':knowledgeId/graph/entities')
  @UseGuards(PermissionGuard)
  @RequirePermissions('documents:view')
  @ApiOperation({ summary: '查询知识库提取的所有图谱实体' })
  listEntities(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query() query: KnowledgeGraphListEntitiesQueryDto,
    @Req() req: any,
  ) {
    return this.graphService.listEntities(
      knowledgeId,
      query.q,
      query.limit,
      this.accessScope(req),
    );
  }

  @Get(':knowledgeId/graph/relations')
  @UseGuards(PermissionGuard)
  @RequirePermissions('documents:view')
  @ApiOperation({ summary: '查询知识库提取的所有实体关系' })
  listRelations(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query() query: KnowledgeGraphListRelationsQueryDto,
    @Req() req: any,
  ) {
    return this.graphService.listRelations(
      knowledgeId,
      query.limit,
      this.accessScope(req),
    );
  }

  @Get(':knowledgeId/graph/overview')
  @UseGuards(PermissionGuard)
  @RequirePermissions('documents:view')
  @ApiOperation({ summary: '查询知识库图谱概览，用于前端关系画布' })
  getGraphOverview(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query() query: KnowledgeGraphOverviewQueryDto,
    @Req() req: any,
  ) {
    return this.graphService.getOverview(
      knowledgeId,
      query.limit,
      this.accessScope(req),
    );
  }

  @Get(':knowledgeId/graph/neighborhood')
  @UseGuards(PermissionGuard)
  @RequirePermissions('documents:view')
  @ApiOperation({ summary: '查询知识库中某个节点的邻居子图关系' })
  getNeighborhood(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query() query: KnowledgeGraphNeighborhoodQueryDto,
    @Req() req: any,
  ) {
    return this.graphService.getNeighborhood(
      knowledgeId,
      query.nodeKey,
      this.accessScope(req),
    );
  }

  @Post(':knowledgeId/graph/rebuild')
  @UseGuards(PermissionGuard)
  @RequirePermissions('documents:retry')
  @ApiOperation({ summary: '触发知识库图谱全量重建同步' })
  rebuildGraph(@Param('knowledgeId', ParseUUIDPipe) knowledgeId: string) {
    return this.graphService.rebuildGraph(knowledgeId);
  }

  private accessScope(req: any): KnowledgeAccessScope {
    return {
      ownerId: req.user?.id ?? null,
      department: req.user?.department ?? null,
      role: req.user?.role ?? null,
    };
  }
}
