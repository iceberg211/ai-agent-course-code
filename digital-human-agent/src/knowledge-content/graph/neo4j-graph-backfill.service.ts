import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';
import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';
import {
  Neo4jGraphSyncService,
  type Neo4jGraphSyncResult,
} from '@/knowledge-content/graph/neo4j-graph-sync.service';

interface Neo4jGraphBackfillSummary {
  pageCount: number;
  documentCount: number;
  chunkCount: number;
  failedDocumentCount: number;
}

@Injectable()
export class Neo4jGraphBackfillService {
  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    private readonly chunkIndexQueryService: KnowledgeChunkIndexQueryService,
    private readonly graphExtractorService: KnowledgeGraphExtractorService,
    private readonly neo4jGraphSyncService: Neo4jGraphSyncService,
  ) {}

  async backfillAll(pageSize: number): Promise<Neo4jGraphBackfillSummary> {
    let pageCount = 0;
    let documentCount = 0;
    let chunkCount = 0;
    let failedDocumentCount = 0;
    let cursor: string | undefined;

    do {
      const documents = await this.listDocumentPage(pageSize, cursor);
      if (documents.length === 0) break;

      pageCount += 1;
      for (const document of documents) {
        const chunks = await this.chunkIndexQueryService.listByDocumentId(
          document.id,
        );
        const firstChunk = chunks[0];
        if (!firstChunk) continue;

        const graphChunks = chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunk_index,
          source: chunk.source,
          category: chunk.category,
          content: chunk.content,
        }));

        const graphSyncResult = await this.syncDocumentGraph({
          documentId: document.id,
          knowledgeId: firstChunk.knowledge_base_id,
          source: firstChunk.source,
          chunks: graphChunks,
        });
        await this.updateDocumentGraphSyncStatus(document.id, graphSyncResult);

        documentCount += 1;
        chunkCount += chunks.length;
        if (graphSyncResult.status === 'failed') {
          failedDocumentCount += 1;
        }
      }

      cursor = documents.at(-1)?.id;
    } while (cursor);

    return { pageCount, documentCount, chunkCount, failedDocumentCount };
  }

  private async syncDocumentGraph(input: {
    documentId: string;
    knowledgeId: string;
    source: string;
    chunks: Array<{
      id: string;
      chunkIndex: number;
      source: string;
      category: string | null;
      content: string;
    }>;
  }): Promise<Neo4jGraphSyncResult> {
    if (!this.neo4jGraphSyncService.isEnabled()) {
      return { status: 'skipped' };
    }

    try {
      const extractedGraph = await this.graphExtractorService.extract({
        documentId: input.documentId,
        chunks: input.chunks,
      });

      return await this.neo4jGraphSyncService.safeUpsertDocument({
        ...input,
        extractedGraph,
      });
    } catch (error) {
      return {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private updateDocumentGraphSyncStatus(
    documentId: string,
    result: Neo4jGraphSyncResult,
  ): Promise<unknown> {
    return this.documentRepo.update(documentId, {
      graphSyncStatus: result.status,
      graphSyncError: result.status === 'failed' ? result.errorMessage : null,
      graphSyncedAt: result.status === 'indexed' ? new Date() : null,
    });
  }

  private listDocumentPage(
    pageSize: number,
    cursor?: string,
  ): Promise<KnowledgeDocument[]> {
    return this.documentRepo.find({
      where: {
        status: 'completed',
        ...(cursor ? { id: MoreThan(cursor) } : {}),
      },
      order: { id: 'ASC' },
      take: pageSize,
    });
  }
}
