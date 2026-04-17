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
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeSearchDto } from '../knowledge/dto/knowledge-search.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import { UpdateChunkDto } from './dto/update-chunk.dto';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
export class KnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  // -------- KB CRUD --------

  @Get()
  listAll() {
    return this.kbService.listAll();
  }

  @Post()
  create(@Body() dto: CreateKnowledgeBaseDto) {
    return this.kbService.create(dto);
  }

  @Get(':kbId')
  findOne(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.kbService.findOne(kbId);
  }

  @Patch(':kbId')
  update(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.kbService.update(kbId, dto);
  }

  @Delete(':kbId')
  @ApiOperation({ summary: '删除知识库（级联文档 + chunks）' })
  remove(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.kbService.remove(kbId);
  }

  // -------- KB 下的文档管理 --------

  @Get(':kbId/documents')
  listDocuments(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.knowledgeService.listDocumentsByKb(kbId);
  }

  @Post(':kbId/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    const content = await this.extractDocumentText(file);
    return this.knowledgeService.ingestDocument(
      kbId,
      file.originalname,
      content,
      {
        mimeType: file.mimetype,
        fileSize: file.size,
        category,
      },
    );
  }

  @Delete(':kbId/documents/:docId')
  deleteDocument(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.knowledgeService.deleteDocument(docId);
  }

  @Get(':kbId/documents/:docId/chunks')
  listChunks(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.knowledgeService.listChunksByDocumentId(docId);
  }

  // -------- Chunk 启用/禁用 --------

  @Patch(':kbId/chunks/:chunkId')
  @ApiOperation({ summary: '启用或禁用单个 chunk' })
  async updateChunk(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: UpdateChunkDto,
  ) {
    await this.knowledgeService.updateChunkEnabled(chunkId, dto.enabled);
    return { chunkId, enabled: dto.enabled };
  }

  // -------- 单 KB 命中测试 --------

  @Post(':kbId/search')
  @ApiOperation({ summary: '命中测试（stage1 + stage2，单 KB）' })
  search(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    return this.knowledgeService.retrieveWithStages(kbId, body.query, {
      rerank: body.rerank,
      threshold: body.threshold,
      stage1TopK: body.stage1TopK,
      finalTopK: body.finalTopK,
    });
  }

  // -------- 文档文本抽取 --------

  private async extractDocumentText(
    file: Express.Multer.File,
  ): Promise<string> {
    const ext = extname(file.originalname ?? '').toLowerCase();
    const mime = String(file.mimetype ?? '').toLowerCase();

    if (ext === '.pdf' || mime === 'application/pdf') {
      const mod = await import('pdf-parse');
      const parser = new mod.PDFParse({ data: file.buffer });
      let parsedText = '';
      try {
        const parsed = await parser.getText();
        parsedText = String(parsed?.text ?? '').trim();
      } finally {
        await parser.destroy();
      }
      if (!parsedText) {
        throw new BadRequestException('PDF 未解析到可用文本');
      }
      return parsedText;
    }

    const textExtensions = new Set([
      '.txt',
      '.md',
      '.markdown',
      '.csv',
      '.json',
      '.log',
    ]);
    if (mime.startsWith('text/') || textExtensions.has(ext)) {
      const text = file.buffer.toString('utf-8').trim();
      if (!text) {
        throw new BadRequestException('文档内容为空');
      }
      return text;
    }

    throw new BadRequestException('仅支持 txt、md、pdf 文档上传');
  }
}
