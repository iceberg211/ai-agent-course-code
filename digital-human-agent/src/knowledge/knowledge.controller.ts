import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { extname } from 'node:path';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  // POST /knowledge/:personaId/documents  (multipart, field name: file)
  @Post(':personaId/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('personaId') personaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    const content = await this.extractDocumentText(file);
    return this.service.ingestDocument(
      personaId,
      file.originalname,
      content,
      category,
    );
  }

  // GET /knowledge/:personaId/documents
  @Get(':personaId/documents')
  listDocuments(@Param('personaId') personaId: string) {
    return this.service.listDocuments(personaId);
  }

  // DELETE /knowledge/:personaId/documents/:docId
  @Delete(':personaId/documents/:docId')
  deleteDocument(@Param('docId') docId: string) {
    return this.service.deleteDocument(docId);
  }

  private async extractDocumentText(file: Express.Multer.File): Promise<string> {
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
      const text = parsedText;
      if (!text) {
        throw new BadRequestException('PDF 未解析到可用文本');
      }
      return text;
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
