import { Injectable } from '@nestjs/common';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type {
  IngestKnowledgeDocumentOptions,
  KnowledgeChunk,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
} from '@/knowledge-content/types/knowledge-content.types';

export type {
  IngestKnowledgeDocumentOptions,
  KnowledgeChunk,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
} from '@/knowledge-content/types/knowledge-content.types';

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

  retrieveForPersona(personaId: string, query: string): Promise<KnowledgeChunk[]> {
    return this.knowledgeSearchService.retrieveForPersona(personaId, query);
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

  deleteDocument(documentId: string): Promise<void> {
    return this.knowledgeDocumentService.deleteDocument(documentId);
  }

  listDocumentsByKnowledgeId(knowledgeId: string): Promise<KnowledgeDocument[]> {
    return this.knowledgeDocumentService.listDocumentsByKnowledgeId(knowledgeId);
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    return this.knowledgeDocumentService.listChunksByDocumentId(documentId);
  }

  updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    return this.knowledgeDocumentService.updateChunkEnabled(chunkId, enabled);
  }
}
