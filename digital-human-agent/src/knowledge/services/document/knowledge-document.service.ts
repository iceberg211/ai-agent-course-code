import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  KNOWLEDGE_UPLOAD_PDF_MIME_TYPE,
  KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET,
} from '@/common/constants';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import type { IngestKnowledgeDocumentOptions } from '@/knowledge/types/knowledge-content.types';
import { splitKnowledgeDocumentContent } from './markdown-splitter';

import type {
  KnowledgeDocumentChunk,
  KnowledgeDocumentChunkRow,
} from '@/knowledge/types/knowledge-document.types';

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly runtime: ContentRuntimeService,
    private readonly elasticsearchService: ElasticsearchIndexService,
    private readonly graphService: KnowledgeGraphService,
  ) {}

  // ==========================================
  // 删除文档与索引清理
  // ==========================================
  async deleteDocument(documentId: string): Promise<void> {
    await this.documentRepo.delete(documentId);
    await this.cleanupDocument(documentId, `删除文档 ${documentId}`);
  }

  // ==========================================
  // 文档导入/分片与 Embedding 入库
  // ==========================================
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
      );
      this.logger.log(
        `[切分完成] filename=${filename} chunks=${splitDocuments.length}`,
      );

      const texts = splitDocuments.map((item) => item.pageContent);
      this.logger.log(
        `[开始 Embedding] model=${this.runtime.embeddings.model} texts=${texts.length} batchSize=${this.runtime.embeddingBatchSize}`,
      );
      const embeddings = await this.runtime.embeddings.embedDocuments(texts);
      this.logger.log(`[Embedding 完成] dims=${embeddings[0]?.length}`);

      const chunkRows = splitDocuments.map((item, index) => ({
        id: randomUUID(),
        document_id: document.id,
        chunk_index: index,
        content: item.pageContent,
        source: filename,
        category: options.category ?? null,
        enabled: true,
        embedding: JSON.stringify(embeddings[index]),
      })) satisfies KnowledgeDocumentChunkRow[];

      // 1. 写入 Supabase PG 数据库
      await this.insertChunkRows(document.id, chunkRows);

      // 2. 写入 Elasticsearch 索引
      await this.syncDocumentIndex({
        documentId: document.id,
        knowledgeId,
        rows: chunkRows,
      });

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: splitDocuments.length,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      });

      // 3. 后置异步尽力同步 Neo4j 知识图谱
      await this.syncGraphBestEffort({
        documentId: document.id,
        knowledgeId,
        source: filename,
        rows: chunkRows,
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

  // ==========================================
  // 启用/停用单个 Chunk 并同步索引
  // ==========================================
  async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    const context = `更新 chunk ${chunkId}`;
    const { error } = await this.runtime.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);

    if (error) {
      throw new Error(error.message);
    }

    await this.syncChunkEnabled(chunkId, enabled, context);
  }

  // ==========================================
  // 内部辅助数据库写入与第三方引擎同步逻辑 (原本在 sync.service)
  // ==========================================
  private async insertChunkRows(
    documentId: string,
    rows: KnowledgeDocumentChunkRow[],
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

  private async syncDocumentIndex(input: {
    documentId: string;
    knowledgeId: string;
    rows: KnowledgeDocumentChunkRow[];
  }): Promise<void> {
    await this.elasticsearchService.safeBulkUpsertChunkDocuments(
      input.rows.map((row) => ({
        id: row.id,
        document_id: row.document_id,
        knowledge_base_id: input.knowledgeId,
        chunk_index: row.chunk_index,
        content: row.content,
        source: row.source,
        category: row.category,
        enabled: row.enabled,
      })),
      `写入文档 ${input.documentId}`,
    );
  }

  private async syncChunkEnabled(
    chunkId: string,
    enabled: boolean,
    context: string,
  ): Promise<void> {
    const chunkDocument = await this.elasticsearchService.findByChunkId(chunkId);
    if (chunkDocument) {
      await this.elasticsearchService.safeBulkUpsertChunkDocuments(
        [chunkDocument],
        context,
      );
    }

    await this.graphService.safeUpdateChunkEnabled(
      chunkId,
      enabled,
      context,
    );
  }

  private async syncGraphBestEffort(input: {
    documentId: string;
    knowledgeId: string;
    source: string;
    rows: KnowledgeDocumentChunkRow[];
  }): Promise<void> {
    try {
      const graphSyncResult = await this.syncDocumentGraph({
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

      await this.documentRepo.update(input.documentId, {
        graphSyncStatus: graphSyncResult.status,
        graphSyncError:
          graphSyncResult.status === 'failed'
            ? graphSyncResult.errorMessage
            : null,
        graphSyncedAt: graphSyncResult.status === 'indexed' ? new Date() : null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `图谱后置同步失败（doc=${input.documentId}）：${errorMessage}`,
      );
      await this.documentRepo.update(input.documentId, {
        graphSyncStatus: 'failed',
        graphSyncError: errorMessage,
        graphSyncedAt: null,
      });
    }
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
  }) {
    if (!this.graphService.isEnabled()) {
      return { status: 'skipped' as const };
    }

    try {
      const extractedGraph = await this.graphService.extract({
        documentId: input.documentId,
        chunks: input.chunks,
      });

      return await this.graphService.safeUpsertDocument({
        ...input,
        extractedGraph,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `图谱抽取失败（document=${input.documentId}）：${errorMessage}`,
      );
      return { status: 'failed' as const, errorMessage };
    }
  }

  private async cleanupDocument(documentId: string, reason: string): Promise<void> {
    try {
      await this.elasticsearchService.safeDeleteByDocumentId(documentId, reason);
    } catch (error) {
      this.logger.warn(
        `清理 ES 索引失败（doc=${documentId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await this.graphService.safeDeleteByDocumentId(documentId, reason);
    } catch (error) {
      this.logger.warn(
        `清理图谱节点失败（doc=${documentId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

    try {
      await this.cleanupDocument(
        documentId,
        `导入失败清理文档 ${documentId}`,
      );
    } catch (error) {
      this.logger.warn(
        `导入失败清理文档索引与图谱失败（doc=${documentId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ==========================================
  // 从门面服务迁入：文档上传解析与摄入
  // ==========================================
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
