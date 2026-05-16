import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import type { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch.types';
import { ElasticsearchSyncService } from '@/knowledge-content/elasticsearch/elasticsearch-sync.service';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';
import { KnowledgeContextualRetrievalService } from '@/knowledge-content/services/knowledge-contextual-retrieval.service';
import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';
import {
  Neo4jGraphSyncService,
  type Neo4jGraphSyncResult,
} from '@/knowledge-content/graph/neo4j-graph-sync.service';
import { splitKnowledgeDocumentContent } from '@/knowledge-content/services/knowledge-document-chunking.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type { IngestKnowledgeDocumentOptions } from '@/knowledge-content/types/knowledge-content.types';

interface InsertChunkRow {
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
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly elasticsearchSyncService: ElasticsearchSyncService,
    private readonly graphExtractorService: KnowledgeGraphExtractorService,
    private readonly neo4jGraphSyncService: Neo4jGraphSyncService,
    private readonly knowledgeChunkIndexQueryService: KnowledgeChunkIndexQueryService,
    private readonly contextualRetrievalService: KnowledgeContextualRetrievalService,
  ) {}

  async deleteDocument(documentId: string): Promise<void> {
    await this.documentRepo.delete(documentId);
    await this.elasticsearchSyncService.safeDeleteByDocumentId(
      documentId,
      `删除文档 ${documentId}`,
    );
    await this.neo4jGraphSyncService.safeDeleteByDocumentId(
      documentId,
      `删除文档 ${documentId}`,
    );
  }

  async ingestDocument(
    knowledgeId: string,
    filename: string,
    content: string,
    options: IngestKnowledgeDocumentOptions = {},
  ): Promise<KnowledgeDocument> {
    const document = await this.documentRepo.save(
      this.documentRepo.create({
        knowledgeBaseId: knowledgeId,
        filename,
        status: 'processing',
        mimeType: options.mimeType ?? null,
        fileSize: options.fileSize ?? null,
      }),
    );

    try {
      const splitDocuments = await splitKnowledgeDocumentContent(
        content,
        this.runtime.splitter,
        {
          semanticChunking: {
            enabled: this.readBoolean('ENABLE_SEMANTIC_CHUNKING', false),
            embeddings: this.runtime.embeddings,
            similarityThreshold: this.readNumber(
              'SEMANTIC_CHUNKING_SIMILARITY_THRESHOLD',
            ),
            maxChunkLength: this.readNumber('SEMANTIC_CHUNKING_MAX_CHARS'),
          },
        },
      );
      this.logger.log(
        `[切分完成] filename=${filename} chunks=${splitDocuments.length}`,
      );
      const enrichedDocuments =
        await this.contextualRetrievalService.enrichChunks({
          filename,
          documentContent: content,
          chunks: splitDocuments,
        });

      const texts = enrichedDocuments.map((item) => item.pageContent);
      this.logger.log(
        `[开始 Embedding] model=${this.runtime.embeddings.model} texts=${texts.length} batchSize=${this.runtime.embeddingBatchSize}`,
      );
      const embeddings = await this.runtime.embeddings.embedDocuments(texts);
      this.logger.log(`[Embedding 完成] dims=${embeddings[0]?.length}`);

      const chunkRows = enrichedDocuments.map((item, index) => ({
        id: randomUUID(),
        document_id: document.id,
        chunk_index: index,
        content: item.pageContent,
        source: filename,
        category: options.category ?? null,
        enabled: true,
        embedding: JSON.stringify(embeddings[index]),
      })) satisfies InsertChunkRow[];

      await this.insertChunkRows(document.id, chunkRows);
      await this.elasticsearchSyncService.safeBulkUpsertChunkDocuments(
        chunkRows.map((row) => this.toIndexDocument(row, knowledgeId)),
        `写入文档 ${document.id}`,
      );
      const graphChunks = chunkRows.map((row) => ({
        id: row.id,
        chunkIndex: row.chunk_index,
        source: row.source,
        category: row.category,
        content: row.content,
      }));
      const graphSyncResult = await this.syncDocumentGraph({
        documentId: document.id,
        knowledgeId,
        source: filename,
        chunks: graphChunks,
      });

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: enrichedDocuments.length,
        graphSyncStatus: graphSyncResult.status,
        graphSyncError:
          graphSyncResult.status === 'failed'
            ? graphSyncResult.errorMessage
            : null,
        graphSyncedAt: graphSyncResult.status === 'indexed' ? new Date() : null,
      });

      return this.documentRepo.findOneByOrFail({ id: document.id });
    } catch (error) {
      this.logger.error('Ingest failed', error);
      await this.cleanupFailedIngest(document.id);
      await this.documentRepo.update(document.id, {
        status: 'failed',
        chunkCount: 0,
      });
      throw error;
    }
  }

  listDocumentsByKnowledgeId(
    knowledgeId: string,
  ): Promise<KnowledgeDocument[]> {
    return this.documentRepo.find({
      where: { knowledgeBaseId: knowledgeId },
      order: { createdAt: 'DESC' },
    });
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    return this.chunkRepo
      .createQueryBuilder('chunk')
      .where('chunk.document_id = :documentId', { documentId })
      .orderBy('chunk.chunk_index', 'ASC')
      .getMany();
  }

  async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    const context = `更新 chunk ${chunkId}`;
    const { error } = await this.runtime.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);

    if (error) {
      throw new Error(error.message);
    }

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

  private async insertChunkRows(
    documentId: string,
    rows: InsertChunkRow[],
  ): Promise<void> {
    this.logger.log(`[开始 Insert] doc=${documentId} rows=${rows.length}`);

    const batchSize = 50;
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      const result = await this.runtime.withTransientRetry<{
        error: { message: string } | null;
      }>(
        `insert batch ${Math.floor(index / batchSize) + 1}`,
        async () => {
          const response = await this.runtime.supabase
            .from('knowledge_chunk')
            .insert(batch);

          return {
            error: response.error ? { message: response.error.message } : null,
          };
        },
        3,
      );

      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    this.logger.log(
      `[Insert 完成] doc=${documentId} batches=${Math.ceil(rows.length / batchSize)}`,
    );
  }

  private async cleanupFailedIngest(documentId: string): Promise<void> {
    try {
      await this.chunkRepo.delete({ documentId });
    } catch (error) {
      this.logger.warn(
        `导入失败清理 chunk 失败（doc=${documentId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.elasticsearchSyncService.safeDeleteByDocumentId(
      documentId,
      `导入失败清理文档 ${documentId}`,
    );
    await this.neo4jGraphSyncService.safeDeleteByDocumentId(
      documentId,
      `导入失败清理文档 ${documentId}`,
    );
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `图谱抽取失败（document=${input.documentId}）：${errorMessage}`,
      );
      return { status: 'failed', errorMessage };
    }
  }

  private toIndexDocument(
    row: InsertChunkRow,
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

  private readBoolean(key: string, fallback: boolean): boolean {
    const rawValue = String(process.env[key] ?? '').trim();
    if (!rawValue) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase());
  }

  private readNumber(key: string): number | undefined {
    const value = Number(process.env[key]);
    return Number.isFinite(value) ? value : undefined;
  }
}
