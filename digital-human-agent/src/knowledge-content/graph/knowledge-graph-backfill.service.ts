import { Injectable } from '@nestjs/common';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';
import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';
import { KnowledgeGraphSyncService } from '@/knowledge-content/graph/knowledge-graph-sync.service';
import {
  DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION,
  DEFAULT_RAG_GRAPH_SCHEMA_VERSION,
  type KnowledgeGraphChunkRef,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';

interface KnowledgeGraphBackfillSummary {
  pageCount: number;
  documentCount: number;
  chunkCount: number;
  staleDocumentCount: number;
}

@Injectable()
export class KnowledgeGraphBackfillService {
  constructor(
    private readonly knowledgeChunkIndexQueryService: KnowledgeChunkIndexQueryService,
    private readonly graphSyncService: KnowledgeGraphSyncService,
    private readonly graphExtractorService: KnowledgeGraphExtractorService,
  ) {}

  async backfillAll(
    pageSize = 200,
    versions: {
      extractorVersion?: string;
      schemaVersion?: string;
    } = {},
  ): Promise<KnowledgeGraphBackfillSummary> {
    const extractorVersion =
      versions.extractorVersion?.trim() || currentExtractorVersion();
    const schemaVersion = versions.schemaVersion?.trim() || currentSchemaVersion();
    const staleDocumentCount = await this.graphSyncService.markStaleByVersion({
      extractorVersion,
      schemaVersion,
    });

    let pageCount = 0;
    let chunkCount = 0;
    const processedDocumentIds = new Set<string>();
    let cursor:
      | {
          createdAt: string;
          id: string;
        }
      | undefined;

    while (true) {
      const page = await this.knowledgeChunkIndexQueryService.listPage(
        pageSize,
        cursor,
      );
      if (page.items.length === 0) break;

      pageCount += 1;

      const documentIds = Array.from(
        new Set(page.items.map((item) => item.document_id)),
      ).filter((documentId) => !processedDocumentIds.has(documentId));

      for (const documentId of documentIds) {
        const chunks =
          await this.knowledgeChunkIndexQueryService.listByDocumentId(
            documentId,
          );
        const graphChunks = chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunk_index,
          source: chunk.source,
          content: chunk.content,
        }));
        const extractedGraph = await this.extractGraphOrMarkFailed(
          documentId,
          graphChunks,
          extractorVersion,
          schemaVersion,
        );
        await this.graphSyncService.bulkUpsertGraph({
          documentId,
          chunks: graphChunks,
          extractedGraph,
          extractorVersion,
          schemaVersion,
        });
        processedDocumentIds.add(documentId);
        chunkCount += chunks.length;
      }

      if (!page.nextCursor || page.items.length < pageSize) break;
      cursor = page.nextCursor;
    }

    return {
      pageCount,
      documentCount: processedDocumentIds.size,
      chunkCount,
      staleDocumentCount,
    };
  }

  private async extractGraphOrMarkFailed(
    documentId: string,
    chunks: KnowledgeGraphChunkRef[],
    extractorVersion: string,
    schemaVersion: string,
  ) {
    try {
      return await this.graphExtractorService.extract({
        documentId,
        chunks,
      });
    } catch (error) {
      await this.graphSyncService.markFailed({
        documentId,
        extractorVersion,
        schemaVersion,
        error,
      });
      throw error;
    }
  }
}

function currentExtractorVersion(): string {
  return (
    process.env.RAG_GRAPH_EXTRACTOR_VERSION?.trim() ||
    DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION
  );
}

function currentSchemaVersion(): string {
  return (
    process.env.GRAPH_INDEX_VERSION?.trim() || DEFAULT_RAG_GRAPH_SCHEMA_VERSION
  );
}
