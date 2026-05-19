import { Injectable, Logger } from '@nestjs/common';
import type { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch.types';
import { ElasticsearchSyncService } from '@/knowledge-content/elasticsearch/elasticsearch-sync.service';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';
import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';
import {
  Neo4jGraphSyncService,
  type Neo4jGraphSyncResult,
} from '@/knowledge-content/graph/neo4j-graph-sync.service';

export interface KnowledgeDocumentChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  source: string;
  category: string | null;
  enabled: boolean;
  embedding: string;
}

@Injectable()
export class KnowledgeDocumentIndexSyncService {
  private readonly logger = new Logger(KnowledgeDocumentIndexSyncService.name);

  constructor(
    private readonly elasticsearchSyncService: ElasticsearchSyncService,
    private readonly graphExtractorService: KnowledgeGraphExtractorService,
    private readonly neo4jGraphSyncService: Neo4jGraphSyncService,
    private readonly knowledgeChunkIndexQueryService: KnowledgeChunkIndexQueryService,
  ) {}

  async syncDocumentIndex(input: {
    documentId: string;
    knowledgeId: string;
    rows: KnowledgeDocumentChunkRow[];
  }): Promise<void> {
    await this.elasticsearchSyncService.safeBulkUpsertChunkDocuments(
      input.rows.map((row) => this.toIndexDocument(row, input.knowledgeId)),
      `写入文档 ${input.documentId}`,
    );
  }

  async syncCreatedDocument(input: {
    documentId: string;
    knowledgeId: string;
    source: string;
    rows: KnowledgeDocumentChunkRow[];
  }): Promise<Neo4jGraphSyncResult> {
    await this.syncDocumentIndex(input);
    return this.syncDocumentGraph({
      documentId: input.documentId,
      knowledgeId: input.knowledgeId,
      source: input.source,
      chunks: input.rows.map((row) => ({
        id: row.id,
        chunkIndex: row.chunk_index,
        source: row.source,
        category: row.category,
        content: row.content,
      })),
    });
  }

  async cleanupDocument(documentId: string, reason: string): Promise<void> {
    await this.elasticsearchSyncService.safeDeleteByDocumentId(
      documentId,
      reason,
    );
    await this.neo4jGraphSyncService.safeDeleteByDocumentId(documentId, reason);
  }

  async syncChunkEnabled(
    chunkId: string,
    enabled: boolean,
    context: string,
  ): Promise<void> {
    const chunkDocument =
      await this.knowledgeChunkIndexQueryService.findByChunkId(chunkId);
    if (chunkDocument) {
      await this.elasticsearchSyncService.safeBulkUpsertChunkDocuments(
        [chunkDocument],
        context,
      );
    }

    await this.neo4jGraphSyncService.safeUpdateChunkEnabled(
      chunkId,
      enabled,
      context,
    );
  }

  async syncDocumentGraph(input: {
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `图谱抽取失败（document=${input.documentId}）：${errorMessage}`,
      );
      return { status: 'failed', errorMessage };
    }
  }

  private toIndexDocument(
    row: KnowledgeDocumentChunkRow,
    knowledgeId: string,
  ): KnowledgeChunkIndexDocument {
    return {
      id: row.id,
      document_id: row.document_id,
      knowledge_base_id: knowledgeId,
      chunk_index: row.chunk_index,
      content: row.content,
      source: row.source,
      category: row.category,
      enabled: row.enabled,
    };
  }
}
