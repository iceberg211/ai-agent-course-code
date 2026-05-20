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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { extname } from 'node:path';
import {
  KNOWLEDGE_UPLOAD_PDF_MIME_TYPE,
  KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET,
} from '@/common/constants';
import { KnowledgeSearchDto } from '@/knowledge/dto/knowledge-search.dto';
import { KnowledgeContentService } from '@/knowledge/services/manage/knowledge-content.service';
import { UpdateChunkDto } from '@/knowledge/dto/update-chunk.dto';

const KNOWLEDGE_UPLOAD_MAX_FILE_SIZE = 20 * 1024 * 1024;

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

@ApiTags('knowledge-content')
@Controller('knowledge-bases')
export class KnowledgeContentController {
  constructor(
    private readonly knowledgeContentService: KnowledgeContentService,
  ) {}

  @Get(':kbId/documents')
  listDocuments(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.knowledgeContentService.listDocumentsByKnowledgeId(kbId);
  }

  @Post(':kbId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: KNOWLEDGE_UPLOAD_MAX_FILE_SIZE },
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
    return this.knowledgeContentService.parseAndIngestDocument(
      kbId,
      file,
      category,
    );
  }

  @Delete(':kbId/documents/:docId')
  deleteDocument(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.knowledgeContentService.deleteDocument(docId);
  }

  @Get(':kbId/documents/:docId/chunks')
  listChunks(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.knowledgeContentService.listChunksByDocumentId(docId);
  }

  @Patch(':kbId/chunks/:chunkId')
  @ApiOperation({ summary: '启用或禁用单个 chunk' })
  async updateChunk(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: UpdateChunkDto,
  ) {
    await this.knowledgeContentService.updateChunkEnabled(chunkId, dto.enabled);
    return { chunkId, enabled: dto.enabled };
  }

  @Post(':kbId/search')
  @ApiOperation({ summary: '命中测试（混合检索召回 + 重排，单 KB）' })
  search(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    return this.knowledgeContentService.retrieveWithStages(kbId, body.query, {
      rerank: body.rerank,
      threshold: body.threshold,
      retrievalLimit: body.retrievalLimit ?? body.stage1TopK,
      rerankLimit: body.rerankLimit ?? body.finalTopK,
    });
  }

}
