import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListDocumentsDto } from '@/knowledge/dto/list-documents.dto';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';

@ApiTags('documents')
@Controller('documents')
export class DocumentManagementController {
  constructor(private readonly documentService: KnowledgeDocumentService) {}

  @Get()
  @ApiOperation({ summary: '跨知识库分页查询文档' })
  list(@Query() query: ListDocumentsDto) {
    return this.documentService.listDocuments(query);
  }
}
