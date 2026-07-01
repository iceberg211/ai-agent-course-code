import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
} from '@/common/constants';
import { ChunkContextDto } from '@/knowledge/dto/chunk-context.dto';
import { ListDocumentTasksDto } from '@/knowledge/dto/list-document-tasks.dto';
import {
  BatchRetryDocumentsDto,
  ListDocumentsDto,
} from '@/knowledge/dto/list-documents.dto';
import { UploadDocumentDto } from '@/knowledge/dto/upload-document.dto';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { DocumentTaskService } from '@/knowledge/services/document/document-task.service';
import { UpdateChunkDto } from '@/knowledge/dto/update-chunk.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

function isSupportedKnowledgeUpload(file: {
  originalname?: string;
  mimetype?: string;
}): boolean {
  const ext = extname(file.originalname ?? '').toLowerCase();
  const mime = String(file.mimetype ?? '').toLowerCase();

  // 1. 文本与 Markdown、HTML网页
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xhtml+xml' ||
    ['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xhtml'].includes(ext)
  ) {
    return true;
  }

  // 2. PDF
  if (ext === '.pdf' || mime === KNOWLEDGE_UPLOAD_PDF_MIME_TYPE) {
    return true;
  }

  // 3. Office
  if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
    return true;
  }

  // 4. 图片
  if (
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(ext)
  ) {
    return true;
  }

  // 5. 音频
  if (
    mime.startsWith('audio/') ||
    ['.mp3', '.wav', '.mpeg', '.ogg', '.m4a', '.flac'].includes(ext)
  ) {
    return true;
  }

  // 6. 视频
  if (
    mime.startsWith('video/') ||
    ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)
  ) {
    return true;
  }

  return false;
}

const MULTIPART_MAX_FILE_SIZE = 100 * 1024 * 1024; // 上调至 100MB 以承接大视频
const FILE_SIZE_LIMITS = {
  text: 10 * 1024 * 1024,
  pdf: 30 * 1024 * 1024,
  office: 30 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

@ApiTags('documents')
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('documents:view')
export class KnowledgeDocumentController {
  constructor(
    private readonly documentService: KnowledgeDocumentService,
    private readonly documentTaskService: DocumentTaskService,
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
  @RequirePermissions('documents:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTIPART_MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isSupportedKnowledgeUpload(file)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException('不支持的文件格式。仅支持 txt、md、pdf、docx、xlsx、pptx、html 网页以及图片、音频、视频文件上传'), false);
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
    this.validateUploadFileSize(file);
    return this.documentTaskService.createUploadIngestTask(kbId, file, {
      ...this.normalizeDocumentMetadataInput(dto, req, {
        defaultVisibility: 'private',
      }),
      ownerId: req.user?.id,
    });
  }

  @Post('knowledge-bases/:kbId/documents/upload')
  @RequirePermissions('documents:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTIPART_MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isSupportedKnowledgeUpload(file)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException('不支持的文件格式。仅支持 txt、md、pdf、docx、xlsx、pptx、html 网页以及图片、音频、视频文件上传'), false);
      },
    }),
  )
  @ApiOperation({ summary: '创建文档上传处理任务' })
  async uploadDocumentTask(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    this.validateUploadFileSize(file);
    return this.documentTaskService.createUploadIngestTask(kbId, file, {
      ...this.normalizeDocumentMetadataInput(dto, req, {
        defaultVisibility: 'private',
      }),
      ownerId: req.user?.id,
    });
  }

  @Post('knowledge-bases/:kbId/documents/:docId/versions')
  @RequirePermissions('documents:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTIPART_MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isSupportedKnowledgeUpload(file)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException('不支持的文件格式。仅支持 txt、md、pdf、docx、xlsx、pptx、html 网页以及图片、音频、视频文件上传'), false);
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
    this.validateUploadFileSize(file);
    return this.documentTaskService.createUploadVersionTask(
      kbId,
      docId,
      file,
      {
        ...this.normalizeDocumentMetadataInput(dto, req),
        ownerId: req.user?.id,
      },
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
  @RequirePermissions('documents:version:set-current')
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
  @RequirePermissions('documents:archive')
  @ApiOperation({ summary: '归档文档版本' })
  archiveDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.archiveDocument(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Patch('knowledge-bases/:kbId/documents/:docId/governance')
  @RequirePermissions('documents:upload')
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
      this.normalizeDocumentMetadataInput(dto, req),
      this.accessScope(req),
    );
  }

  @Delete('knowledge-bases/:kbId/documents/:docId')
  @RequirePermissions('documents:delete')
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
  @RequirePermissions('documents:retry')
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
  @RequirePermissions('documents:retry')
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

  @Get('knowledge-bases/:kbId/documents/:docId/assets')
  @ApiOperation({ summary: '查询文档多模态资源列表' })
  listDocumentAssets(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.listAssetsByKnowledgeDocument(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Get('documents/:docId/assets')
  @ApiOperation({ summary: '按文档 ID 查询多模态资源列表' })
  listDocumentAssetsById(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.listAssetsByDocumentId(
      docId,
      this.accessScope(req),
    );
  }

  @Get('knowledge-bases/:kbId/documents/:docId/markdown')
  @ApiOperation({ summary: '读取文档解析后的 Markdown' })
  getDocumentMarkdown(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.getMarkdownForKnowledgeDocument(
      kbId,
      docId,
      this.accessScope(req),
    );
  }

  @Get('documents/:docId/markdown')
  @ApiOperation({ summary: '按文档 ID 读取解析后的 Markdown' })
  getDocumentMarkdownById(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentService.getMarkdownByDocumentId(
      docId,
      this.accessScope(req),
    );
  }

  @Get('documents/:docId/tasks')
  @ApiOperation({ summary: '查询文档处理任务列表' })
  listDocumentTasks(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: any,
  ) {
    return this.documentTaskService.listTasksByDocument(
      docId,
      this.accessScope(req),
    );
  }

  @Get('document-tasks')
  @ApiOperation({ summary: '分页查询文档处理任务' })
  listDocumentTaskPage(@Query() query: ListDocumentTasksDto, @Req() req: any) {
    return this.documentTaskService.listTasks({
      ...query,
      accessScope: this.accessScope(req),
    });
  }

  @Get('document-tasks/:taskId')
  @ApiOperation({ summary: '查询文档处理任务详情' })
  getDocumentTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() req: any,
  ) {
    return this.documentTaskService.getTaskDetail(
      taskId,
      this.accessScope(req),
    );
  }

  @Post('document-tasks/:taskId/retry')
  @RequirePermissions('documents:retry')
  @ApiOperation({ summary: '重试文档处理任务' })
  retryDocumentTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() req: any,
  ) {
    return this.documentTaskService.retryTask(taskId, this.accessScope(req));
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
  @RequirePermissions('documents:upload')
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

  private normalizeDocumentMetadataInput(
    dto: UploadDocumentDto,
    req: any,
    options: { defaultVisibility?: 'private' | 'department' | 'company' } = {},
  ): UploadDocumentDto {
    const user = req.user ?? {};
    if (user.role === 'admin') {
      return { ...dto };
    }

    const userDepartment = this.trimToUndefined(user.department);
    const requestedDepartment = this.trimToUndefined(dto.department);
    if (requestedDepartment && requestedDepartment !== userDepartment) {
      throw new ForbiddenException('无权写入其他部门的文档');
    }
    if (dto.visibility === 'company') {
      throw new ForbiddenException('无权将文档设置为公司可见');
    }
    if (dto.visibility === 'department' && !userDepartment) {
      throw new BadRequestException('当前用户没有部门信息，不能设置部门可见');
    }

    const visibility = dto.visibility ?? options.defaultVisibility;
    return {
      ...dto,
      department: requestedDepartment ?? userDepartment,
      visibility,
    };
  }

  private trimToUndefined(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? text : undefined;
  }

  private validateUploadFileSize(file: Express.Multer.File): void {
    const ext = extname(file.originalname ?? '').toLowerCase();
    const mime = String(file.mimetype ?? '').toLowerCase();
    const size = file.size;

    if (ext === '.pdf' || mime === KNOWLEDGE_UPLOAD_PDF_MIME_TYPE) {
      this.assertFileSize(size, FILE_SIZE_LIMITS.pdf, 'PDF 文件');
      return;
    }

    if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
      this.assertFileSize(size, FILE_SIZE_LIMITS.office, 'Office 文件');
      return;
    }

    if (
      mime.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(ext)
    ) {
      this.assertFileSize(size, FILE_SIZE_LIMITS.image, '图片文件');
      return;
    }

    if (
      mime.startsWith('audio/') ||
      ['.mp3', '.wav', '.mpeg', '.ogg', '.m4a', '.flac'].includes(ext)
    ) {
      this.assertFileSize(size, FILE_SIZE_LIMITS.audio, '音频文件');
      return;
    }

    if (
      mime.startsWith('video/') ||
      ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)
    ) {
      this.assertFileSize(size, FILE_SIZE_LIMITS.video, '视频文件');
      return;
    }

    if (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xhtml+xml' ||
      ['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xhtml'].includes(ext)
    ) {
      this.assertFileSize(size, FILE_SIZE_LIMITS.text, '文本或网页文件');
      return;
    }

    this.assertFileSize(size, FILE_SIZE_LIMITS.text, '上传文件');
  }

  private assertFileSize(size: number, limit: number, label: string): void {
    if (size > limit) {
      const limitMb = Math.floor(limit / 1024 / 1024);
      throw new BadRequestException(`${label}大小超出 ${limitMb}MB 限制`);
    }
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
