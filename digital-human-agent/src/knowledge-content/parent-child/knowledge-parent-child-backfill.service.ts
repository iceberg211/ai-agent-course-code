import { Injectable } from '@nestjs/common';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';
import { KnowledgeParentChildSyncService } from '@/knowledge-content/parent-child/knowledge-parent-child-sync.service';
import {
  DEFAULT_PARENT_CHILD_INDEX_VERSION,
  type ParentChildPlanChunk,
} from '@/knowledge-content/parent-child/knowledge-parent-child-plan';

interface KnowledgeParentChildBackfillSummary {
  pageCount: number;
  documentCount: number;
  chunkCount: number;
  parentCount: number;
  staleDocumentCount: number;
}

@Injectable()
export class KnowledgeParentChildBackfillService {
  constructor(
    private readonly knowledgeChunkIndexQueryService: KnowledgeChunkIndexQueryService,
    private readonly parentChildSyncService: KnowledgeParentChildSyncService,
  ) {}

  async backfillAll(
    pageSize = 200,
    options: {
      indexVersion?: string;
      maxParentChars?: number;
      maxChildChunks?: number;
    } = {},
  ): Promise<KnowledgeParentChildBackfillSummary> {
    const indexVersion =
      options.indexVersion?.trim() || currentParentChildIndexVersion();
    const staleDocumentCount =
      await this.parentChildSyncService.markStaleByVersion({
        indexVersion,
      });

    let pageCount = 0;
    let chunkCount = 0;
    let parentCount = 0;
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
        const parentChunks: ParentChildPlanChunk[] = chunks
          .filter((chunk) => chunk.enabled)
          .map((chunk) => ({
            id: chunk.id,
            chunkIndex: chunk.chunk_index,
            source: chunk.source,
            category: chunk.category,
            content: chunk.content,
          }));

        const summary =
          await this.parentChildSyncService.bulkUpsertParentChunks({
            documentId,
            chunks: parentChunks,
            indexVersion,
            maxParentChars: options.maxParentChars,
            maxChildChunks: options.maxChildChunks,
          });
        processedDocumentIds.add(documentId);
        chunkCount += parentChunks.length;
        parentCount += summary.parentCount;
      }

      if (!page.nextCursor || page.items.length < pageSize) break;
      cursor = page.nextCursor;
    }

    return {
      pageCount,
      documentCount: processedDocumentIds.size,
      chunkCount,
      parentCount,
      staleDocumentCount,
    };
  }
}

function currentParentChildIndexVersion(): string {
  return (
    process.env.PARENT_CHILD_INDEX_VERSION?.trim() ||
    DEFAULT_PARENT_CHILD_INDEX_VERSION
  );
}
