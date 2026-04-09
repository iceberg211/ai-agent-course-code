import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeService } from './knowledge.service';

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
    const content = file.buffer.toString('utf-8');
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
}
