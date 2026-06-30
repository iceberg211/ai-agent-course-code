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
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateKnowledgeDto } from '@/knowledge/dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from '@/knowledge/dto/update-knowledge.dto';
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    @Inject(forwardRef(() => KnowledgeGraphService))
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
  @ApiOperation({ summary: '查询知识库提取的所有图谱实体' })
  listEntities(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query('q') query?: string,
    @Query('limit') limit?: number,
  ) {
    return this.graphService.listEntities(knowledgeId, query, limit);
  }

  @Get(':knowledgeId/graph/relations')
  @ApiOperation({ summary: '查询知识库提取的所有实体关系' })
  listRelations(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query('limit') limit?: number,
  ) {
    return this.graphService.listRelations(knowledgeId, limit);
  }

  @Get(':knowledgeId/graph/neighborhood')
  @ApiOperation({ summary: '查询知识库中某个节点的邻居子图关系' })
  getNeighborhood(
    @Param('knowledgeId', ParseUUIDPipe) knowledgeId: string,
    @Query('nodeKey') nodeKey: string,
  ) {
    return this.graphService.getNeighborhood(knowledgeId, nodeKey);
  }

  @Post(':knowledgeId/graph/rebuild')
  @ApiOperation({ summary: '触发知识库图谱全量重建同步' })
  rebuildGraph(@Param('knowledgeId', ParseUUIDPipe) knowledgeId: string) {
    return this.graphService.rebuildGraph(knowledgeId);
  }
}
