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
  Req,
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
import {
  BatchRetryDocumentsDto,
  ListDocumentsDto,
} from '@/knowledge/dto/list-documents.dto';
import { UploadDocumentDto } from '@/knowledge/dto/upload-document.dto';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { UpdateChunkDto } from '@/knowledge/dto/update-chunk.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';


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
  listAllDocuments(@Query() query: ListDocumentsDto, @Req() req: any) {
    return this.documentService.listDocuments({
      ...query,
      accessScope: this.accessScope(req),
    });
  }

  // ==========================================
  // 2. 属于特定知识库的文档管理接口（原 KnowledgeContentController）
  // ==========================================
  @Get('knowledge-bases/:kbId/documents')
  listDocuments(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Query() query: ListDocumentsDto,
    @Req() req: any,
  ) {
    if (this.hasDocumentListFilters(query)) {
      return this.documentService.listDocumentsForKnowledge(kbId, {
        ...query,
        accessScope: this.accessScope(req),
      });
    }
    return this.documentService.listDocumentsByKnowledgeId(
      kbId,
      this.accessScope(req),
    );
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
    @Body() dto: UploadDocumentDto,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    return this.documentService.parseAndIngestDocument(kbId, file, {
      ...dto,
      ownerId: req.user?.id,
    });
  }

  @Post('knowledge-bases/:kbId/documents/:docId/versions')
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
  @ApiOperation({ summary: '上传文档新版本，并设为当前版本' })
  uploadDocumentVersion(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    return this.documentService.uploadDocumentVersion(
      kbId,
      docId,
      file,
      dto,
      this.accessScope(req),
    );
  }

  @Get('knowledge-bases/:kbId/documents/:docId/versions')
  @ApiOperation({ summary: '查看文档版本历史' })
  listDocumentVersions(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.listDocumentVersions(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Patch('knowledge-bases/:kbId/documents/:docId/current-version')
  @ApiOperation({ summary: '设为当前文档版本' })
  setCurrentDocumentVersion(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.setCurrentDocumentVersion(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Patch('knowledge-bases/:kbId/documents/:docId/archive')
  @ApiOperation({ summary: '归档文档版本' })
  archiveDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.archiveDocument(kbId, docId, this.accessScope(req));
  }

  @Patch('knowledge-bases/:kbId/documents/:docId/governance')
  @ApiOperation({ summary: '更新文档标签、分类、权限与过期时间' })
  updateDocumentGovernance(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UploadDocumentDto,
    @Req() req: any,
  ) {
    return this.documentService.updateDocumentGovernance(
      kbId,
      docId,
      dto,
      this.accessScope(req),
    );
  }

  @Delete('knowledge-bases/:kbId/documents/:docId')
  deleteDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.deleteDocumentForKnowledge(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Post('knowledge-bases/:kbId/documents/:docId/retry')
  @ApiOperation({ summary: '重试文档索引与图谱同步' })
  retryDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.retryDocumentForKnowledge(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Post('knowledge-bases/:kbId/documents/batch-retry')
  @ApiOperation({ summary: '批量重试解析失败的文档' })
  async batchRetry(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body() dto: BatchRetryDocumentsDto,
    @Req() req: any,
  ) {
    const results = await this.documentService.batchRetryDocuments(
      kbId,
      dto.documentIds,
      this.accessScope(req),
    );
    return {
      success: results.every((item) => item.success),
      results,
    };
  }

  @Get('knowledge-bases/:kbId/documents/:docId/chunks')
  listChunks(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.listChunksByKnowledgeDocument(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Get('knowledge-bases/:kbId/documents/:docId/chunks/:chunkId/context')
  @ApiOperation({ summary: '查询 chunk 原文上下文' })
  getChunkContext(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Query() query: ChunkContextDto,
    @Req() req: any,
  ) {
    return this.documentService.getChunkContextForKnowledge(
      kbId,
      docId,
      chunkId,
      query,
      this.accessScope(req),
    );
  }

  @Patch('knowledge-bases/:kbId/chunks/:chunkId')
  @ApiOperation({ summary: '启用或禁用单个 chunk' })
  async updateChunk(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: UpdateChunkDto,
    @Req() req: any,
  ) {
    await this.documentService.updateChunkEnabledForKnowledge(
      kbId,
      chunkId,
      dto.enabled,
      this.accessScope(req),
    );
    return { chunkId, enabled: dto.enabled };
  }

  private accessScope(req: any): KnowledgeAccessScope {
    return {
      ownerId: req.user?.id ?? null,
      department: req.user?.department ?? null,
      role: req.user?.role ?? null,
    };
  }

  private hasDocumentListFilters(query: ListDocumentsDto): boolean {
    return Boolean(
      query.q ||
        query.status ||
        query.graphStatus ||
        query.processingStage ||
        query.tags ||
        query.department ||
        query.businessCategory ||
        query.visibility ||
        query.expiresBefore ||
        query.page ||
        query.pageSize,
    );
  }
}
