import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import {
  KNOWLEDGE_UPLOAD_PDF_MIME_TYPE,
  KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET,
} from '@/common/constants';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/knowledge-search.service';
import type {
  IngestKnowledgeDocumentOptions,
  KnowledgeChunk,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
} from '@/knowledge/types/knowledge-content.types';

export type {
  IngestKnowledgeDocumentOptions,
  KnowledgeChunk,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
} from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class KnowledgeContentService {
  constructor(
    private readonly knowledgeDocumentService: KnowledgeDocumentService,
    private readonly knowledgeSearchService: KnowledgeSearchService,
  ) {}

  retrieve(
    knowledgeId: string,
    query: string,
    options?: RetrieveKnowledgeOptions,
  ): Promise<KnowledgeChunk[]> {
    return this.knowledgeSearchService.retrieve(knowledgeId, query, options);
  }

  retrieveWithStages(
    knowledgeId: string,
    query: string,
    options?: RetrieveKnowledgeOptions,
  ): Promise<RetrieveKnowledgeDebugResult> {
    return this.knowledgeSearchService.retrieveWithStages(
      knowledgeId,
      query,
      options,
    );
  }

  retrieveForPersona(
    personaId: string,
    query: string,
    options?: RetrieveKnowledgeOptions,
  ): Promise<KnowledgeChunk[]> {
    return this.knowledgeSearchService.retrieveForPersona(
      personaId,
      query,
      options,
    );
  }

  ingestDocument(
    knowledgeId: string,
    filename: string,
    content: string,
    options?: IngestKnowledgeDocumentOptions,
  ): Promise<KnowledgeDocument> {
    return this.knowledgeDocumentService.ingestDocument(
      knowledgeId,
      filename,
      content,
      options,
    );
  }

  async parseAndIngestDocument(
    knowledgeId: string,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    category?: string,
  ): Promise<KnowledgeDocument> {
    const content = await this.extractDocumentText(file);
    return this.ingestDocument(knowledgeId, file.originalname, content, {
      mimeType: file.mimetype,
      fileSize: file.size,
      category,
    });
  }

  deleteDocument(documentId: string): Promise<void> {
    return this.knowledgeDocumentService.deleteDocument(documentId);
  }

  listDocumentsByKnowledgeId(
    knowledgeId: string,
  ): Promise<KnowledgeDocument[]> {
    return this.knowledgeDocumentService.listDocumentsByKnowledgeId(
      knowledgeId,
    );
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    return this.knowledgeDocumentService.listChunksByDocumentId(documentId);
  }

  updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    return this.knowledgeDocumentService.updateChunkEnabled(chunkId, enabled);
  }

  private async extractDocumentText(file: {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<string> {
    const ext = extname(file.originalname ?? '').toLowerCase();
    const mime = String(file.mimetype ?? '').toLowerCase();

    if (ext === '.pdf' || mime === KNOWLEDGE_UPLOAD_PDF_MIME_TYPE) {
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

    if (
      mime.startsWith('text/') ||
      KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET.has(ext)
    ) {
      const text = file.buffer.toString('utf-8').trim();
      if (!text) {
        throw new BadRequestException('文档内容为空');
      }
      return text;
    }

    throw new BadRequestException('仅支持 txt、md、pdf 文档上传');
  }
}

