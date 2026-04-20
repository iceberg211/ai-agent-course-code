import { Injectable } from '@nestjs/common';
import { KnowledgeDocumentService } from './knowledge-document.service';
import {
  KnowledgeRetrievalService,
  type RetrieveKnowledgeDebugResult,
  type RetrievePersonaDebugResult,
} from './knowledge-retrieval.service';
import type { KnowledgeChunk, RetrieveKnowledgeOptions } from './domain/retrieval.types';
import { KnowledgeDocument } from './domain/knowledge-document.entity';
import { KnowledgeChunk as KnowledgeChunkEntity } from './domain/knowledge-chunk.entity';

export type { KnowledgeChunk } from './domain/retrieval.types';
export type { RetrieveKnowledgeDebugResult, RetrievePersonaDebugResult } from './knowledge-retrieval.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly retrievalService: KnowledgeRetrievalService,
    private readonly documentService: KnowledgeDocumentService,
  ) {}

  retrieve(
    kbId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    return this.retrievalService.retrieve(kbId, query, options);
  }

  retrieveWithStages(
    kbId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    return this.retrievalService.retrieveWithStages(kbId, query, options);
  }

  retrieveForPersona(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    return this.retrievalService.retrieveForPersona(personaId, query, options);
  }

  retrieveForPersonaWithTrace(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrievePersonaDebugResult> {
    return this.retrievalService.retrieveForPersonaWithTrace(
      personaId,
      query,
      options,
    );
  }

  deleteDocument(documentId: string): Promise<void> {
    return this.documentService.deleteDocument(documentId);
  }

  ingestDocument(
    kbId: string,
    filename: string,
    content: string,
    opts: { mimeType?: string; fileSize?: number; category?: string } = {},
  ): Promise<KnowledgeDocument> {
    return this.documentService.ingestDocument(kbId, filename, content, opts);
  }

  listDocumentsByKb(kbId: string): Promise<KnowledgeDocument[]> {
    return this.documentService.listDocumentsByKb(kbId);
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    return this.documentService.listChunksByDocumentId(documentId);
  }

  updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    return this.documentService.updateChunkEnabled(chunkId, enabled);
  }
}
