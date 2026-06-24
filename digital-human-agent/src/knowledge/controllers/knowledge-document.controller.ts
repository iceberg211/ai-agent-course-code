import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { extname } from 'node:path';
import {
  KNOWLEDGE_UPLOAD_PDF_MIME_TYPE,
  KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET,
  UPLOAD_MAX_FILE_SIZE,
} from '@/common/constants';
import { ChunkContextDto } from '@/knowledge/dto/chunk-context.dto';
import { ListDocumentsDto } from '@/knowledge/dto/list-documents.dto';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { UpdateChunkDto } from '@/knowledge/dto/update-chunk.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';


function isSupportedKnowledgeUpload(file: {
  originalname?: string;
  mimetype?: string;
}): boolean {
  const ext = extname(file.originalname ?? '').toLowerCase();
  const mime = String(file.mimetype ?? '').toLowerCase();
  return (
    ext === '.pdf' ||
    mime === KNOWLEDGE_UPLOAD_PDF_MIME_TYPE ||
    mime.startsWith('text/') ||
    KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET.has(ext)
  );
}

@ApiTags('documents')
@Controller()
@UseGuards(JwtAuthGuard)
export class KnowledgeDocumentController {
  constructor(
    private readonly documentService: KnowledgeDocumentService,
  ) {}

  // ==========================================
  // 1. 跨知识库全局文档查询（原 DocumentManagementController）
  // ==========================================
  @Get('documents')
  @ApiOperation({ summary: '跨知识库分页查询文档' })
  listAllDocuments(@Query() query: ListDocumentsDto) {
    return this.documentService.listDocuments(query);
  }

  // ==========================================
  // 2. 属于特定知识库的文档管理接口（原 KnowledgeContentController）
  // ==========================================
  @Get('knowledge-bases/:kbId/documents')
  listDocuments(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Query() query: ListDocumentsDto,
  ) {
    if (this.hasDocumentListFilters(query)) {
      return this.documentService.listDocumentsForKnowledge(kbId, query);
    }
    return this.documentService.listDocumentsByKnowledgeId(kbId);
  }

  @Post('knowledge-bases/:kbId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isSupportedKnowledgeUpload(file)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException('仅支持 txt、md、pdf 文档上传'), false);
      },
    }),
  )
  async uploadDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    return this.documentService.parseAndIngestDocument(kbId, file, category);
  }

  @Delete('knowledge-bases/:kbId/documents/:docId')
  deleteDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentService.deleteDocumentForKnowledge(kbId, docId);
  }

  @Post('knowledge-bases/:kbId/documents/:docId/retry')
  @ApiOperation({ summary: '重试文档索引与图谱同步' })
  retryDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentService.retryDocumentForKnowledge(kbId, docId);
  }

  @Post('knowledge-bases/:kbId/documents/batch-retry')
  @ApiOperation({ summary: '批量重试解析失败的文档' })
  async batchRetry(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body('documentIds') documentIds: string[],
  ) {
    await this.documentService.batchRetryDocuments(kbId, documentIds);
    return { success: true };
  }

  @Get('knowledge-bases/:kbId/documents/:docId/chunks')
  listChunks(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentService.listChunksByKnowledgeDocument(kbId, docId);
  }

  @Get('knowledge-bases/:kbId/documents/:docId/chunks/:chunkId/context')
  @ApiOperation({ summary: '查询 chunk 原文上下文' })
  getChunkContext(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Query() query: ChunkContextDto,
  ) {
    return this.documentService.getChunkContextForKnowledge(
      kbId,
      docId,
      chunkId,
      query,
    );
  }

  @Patch('knowledge-bases/:kbId/chunks/:chunkId')
  @ApiOperation({ summary: '启用或禁用单个 chunk' })
  async updateChunk(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: UpdateChunkDto,
  ) {
    await this.documentService.updateChunkEnabledForKnowledge(
      kbId,
      chunkId,
      dto.enabled,
    );
    return { chunkId, enabled: dto.enabled };
  }

  private hasDocumentListFilters(query: ListDocumentsDto): boolean {
    return Boolean(
      query.q ||
        query.status ||
        query.graphStatus ||
        query.processingStage ||
        query.page ||
        query.pageSize,
    );
  }
}
