import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  KNOWLEDGE_UPLOAD_PDF_MIME_TYPE,
  KNOWLEDGE_UPLOAD_TEXT_EXTENSION_SET,
  CHUNK_LIST_MAX_TAKE,
  CHUNK_INSERT_BATCH_SIZE,
} from '@/common/constants';
import { normalizePage, normalizePageSize } from '@/common/utils';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import {
  DocumentProcessingStage,
  KnowledgeDocument,
} from '@/knowledge/entities/knowledge-document.entity';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
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
    private readonly runtime: RagRuntimeService,
    private readonly elasticsearchService: ElasticsearchIndexService,
    private readonly graphService: KnowledgeGraphService,
  ) {}

  // ==========================================
  // 删除文档与索引清理
  // ==========================================
  async deleteDocument(documentId: string): Promise<void> {
    await this.cleanupDocument(documentId, `删除文档 ${documentId}`);
    await this.documentRepo.delete(documentId);
  }

  async deleteDocumentForKnowledge(
    knowledgeId: string,
    documentId: string,
  ): Promise<void> {
    await this.findDocumentInKnowledgeOrThrow(knowledgeId, documentId);
    await this.deleteDocument(documentId);
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
        processingStage: 'chunking',
        processingError: null,
        mimeType: options.mimeType ?? null,
        fileSize: options.fileSize ?? null,
      }),
    );

    return this.ingestPreparedDocument(document, knowledgeId, filename, content, options);
  }

  private async ingestPreparedDocument(
    document: KnowledgeDocument,
    knowledgeId: string,
    filename: string,
    content: string,
    options: IngestKnowledgeDocumentOptions = {},
  ): Promise<KnowledgeDocument> {
    try {
      await this.updateDocumentStage(document.id, 'chunking');
      const splitDocuments = await splitKnowledgeDocumentContent(
        content,
        this.runtime.splitter,
      );
      this.logger.log(
        `[切分完成] filename=${filename} chunks=${splitDocuments.length}`,
      );

      const texts = splitDocuments.map((item) => item.pageContent);
      await this.updateDocumentStage(document.id, 'embedding');
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
      await this.updateDocumentStage(document.id, 'keyword_indexing');
      await this.syncDocumentIndex({
        documentId: document.id,
        knowledgeId,
        rows: chunkRows,
      });

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: splitDocuments.length,
        processingStage: 'graph_indexing',
        processingError: null,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      });

      // 3. 后台尽力同步 Neo4j 知识图谱，避免上传请求被长任务阻塞
      this.scheduleGraphSync({
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
        processingStage: 'failed',
        processingError: error instanceof Error ? error.message : String(error),
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

  async listDocumentsForKnowledge(
    knowledgeId: string,
    filters: {
      q?: string;
      status?: string;
      graphStatus?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: KnowledgeDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = normalizePage(filters.page);
    const pageSize = normalizePageSize(filters.pageSize);
    const qb = this.documentRepo
      .createQueryBuilder('document')
      .where('document.knowledge_base_id = :knowledgeId', { knowledgeId })
      .orderBy('document.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const q = String(filters.q ?? '').trim();
    if (q) {
      qb.andWhere('document.filename ILIKE :q', { q: `%${q}%` });
    }
    if (filters.status) {
      qb.andWhere('document.status = :status', { status: filters.status });
    }
    if (filters.graphStatus) {
      qb.andWhere('document.graph_sync_status = :graphStatus', {
        graphStatus: filters.graphStatus,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async listDocuments(
    filters: {
      q?: string;
      knowledgeBaseId?: string;
      fileType?: string;
      status?: string;
      graphStatus?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: KnowledgeDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = normalizePage(filters.page);
    const pageSize = normalizePageSize(filters.pageSize);
    const qb = this.documentRepo
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.knowledge', 'knowledge')
      .orderBy('document.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const q = String(filters.q ?? '').trim();
    if (q) {
      qb.andWhere('document.filename ILIKE :q', { q: `%${q}%` });
    }
    if (filters.knowledgeBaseId) {
      qb.andWhere('document.knowledge_base_id = :knowledgeBaseId', {
        knowledgeBaseId: filters.knowledgeBaseId,
      });
    }
    if (filters.fileType) {
      qb.andWhere(
        '(document.mime_type ILIKE :fileType OR document.filename ILIKE :fileType)',
        { fileType: `%${filters.fileType}%` },
      );
    }
    if (filters.status) {
      qb.andWhere('document.status = :status', { status: filters.status });
    }
    if (filters.graphStatus) {
      qb.andWhere('document.graph_sync_status = :graphStatus', {
        graphStatus: filters.graphStatus,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    // P-1 修复：添加 take(500) 防止大文档单次返回全量 chunks 导致 OOM
    return this.chunkRepo
      .createQueryBuilder('chunk')
      .where('chunk.document_id = :documentId', { documentId })
      .orderBy('chunk.chunk_index', 'ASC')
      .take(CHUNK_LIST_MAX_TAKE)
      .getMany();
  }

  async listChunksByKnowledgeDocument(
    knowledgeId: string,
    documentId: string,
  ): Promise<KnowledgeChunkEntity[]> {
    await this.findDocumentInKnowledgeOrThrow(knowledgeId, documentId);
    return this.listChunksByDocumentId(documentId);
  }

  async getChunkContextForKnowledge(
    knowledgeId: string,
    documentId: string,
    chunkId: string,
    options: { before?: number; after?: number } = {},
  ) {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
    );
    const chunk = await this.findChunkInDocumentOrThrow(documentId, chunkId);
    const before = Math.min(Math.max(Number(options.before ?? 1), 0), 5);
    const after = Math.min(Math.max(Number(options.after ?? 1), 0), 5);
    const start = Math.max(chunk.chunkIndex - before, 0);
    const end = chunk.chunkIndex + after;
    const items = await this.chunkRepo
      .createQueryBuilder('chunk')
      .where('chunk.document_id = :documentId', { documentId })
      .andWhere('chunk.chunk_index BETWEEN :start AND :end', { start, end })
      .orderBy('chunk.chunk_index', 'ASC')
      .getMany();

    return {
      document,
      chunk,
      before,
      after,
      items,
    };
  }

  async retryDocumentForKnowledge(
    knowledgeId: string,
    documentId: string,
  ): Promise<KnowledgeDocument> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
    );
    const chunks = await this.listChunksByDocumentId(documentId);
    if (chunks.length === 0) {
      throw new BadRequestException(
        '当前文档没有可重试的片段，请重新上传原始文件',
      );
    }

    await this.documentRepo.update(document.id, {
      status: 'processing',
      processingStage: 'embedding',
      processingError: null,
      graphSyncStatus: 'pending',
      graphSyncError: null,
      graphSyncedAt: null,
    });

    // E-2 修复：重新生成真实 embedding 向量，不再写入空占位 '[]'
    // 原代码直接 embedding: '[]' 会导致向量检索无法使用这些 chunks（静默数据损坏）
    const texts = chunks.map((c) => c.content);
    this.logger.log(
      `[重试 Embedding] doc=${documentId} chunks=${texts.length}`,
    );
    await this.updateDocumentStage(document.id, 'embedding');
    const embeddings = await this.runtime.embeddings.embedDocuments(texts);
    this.logger.log(`[重试 Embedding 完成] dims=${embeddings[0]?.length}`);

    const rows = chunks.map((chunk, index) => ({
      id: chunk.id,
      document_id: document.id,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      source: chunk.source,
      category: chunk.category,
      enabled: chunk.enabled,
      // 使用真实 embedding 向量而非空占位
      embedding: JSON.stringify(embeddings[index]),
    }));

    await this.updateDocumentStage(document.id, 'keyword_indexing');
    await this.syncDocumentIndex({
      documentId: document.id,
      knowledgeId,
      rows,
    });

    await this.documentRepo.update(document.id, {
      status: 'completed',
      chunkCount: chunks.length,
      processingStage: 'graph_indexing',
      processingError: null,
    });

    this.scheduleGraphSync({
      documentId: document.id,
      knowledgeId,
      source: document.filename,
      rows,
    });

    return this.documentRepo.findOneByOrFail({ id: document.id });
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

  async updateChunkEnabledForKnowledge(
    knowledgeId: string,
    chunkId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.findChunkInKnowledgeOrThrow(knowledgeId, chunkId);
    return this.updateChunkEnabled(chunkId, enabled);
  }

  private async findDocumentInKnowledgeOrThrow(
    knowledgeId: string,
    documentId: string,
  ): Promise<KnowledgeDocument> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId, knowledgeBaseId: knowledgeId },
    });
    if (!document) {
      throw new NotFoundException('文档不属于当前知识库或不存在');
    }
    return document;
  }

  private async findChunkInKnowledgeOrThrow(
    knowledgeId: string,
    chunkId: string,
  ): Promise<void> {
    const row = await this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin('chunk.document', 'document')
      .where('chunk.id = :chunkId', { chunkId })
      .andWhere('document.knowledge_base_id = :knowledgeId', { knowledgeId })
      .getOne();

    if (!row) {
      throw new NotFoundException('chunk 不属于当前知识库或不存在');
    }
  }

  private async findChunkInDocumentOrThrow(
    documentId: string,
    chunkId: string,
  ): Promise<KnowledgeChunkEntity> {
    const chunk = await this.chunkRepo.findOne({
      where: { id: chunkId, documentId },
    });
    if (!chunk) {
      throw new NotFoundException('chunk 不属于当前文档或不存在');
    }
    return chunk;
  }

  // ==========================================
  // 内部辅助数据库写入与第三方引擎同步逻辑 (原本在 sync.service)
  // ==========================================
  private async insertChunkRows(
    documentId: string,
    rows: KnowledgeDocumentChunkRow[],
  ): Promise<void> {
    this.logger.log(`[开始 Insert] doc=${documentId} rows=${rows.length}`);

    const batchSize = CHUNK_INSERT_BATCH_SIZE;
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
    const chunkDocument =
      await this.elasticsearchService.findByChunkId(chunkId);
    if (chunkDocument) {
      await this.elasticsearchService.safeBulkUpsertChunkDocuments(
        [chunkDocument],
        context,
      );
    }

    await this.graphService.safeUpdateChunkEnabled(chunkId, enabled, context);
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
        processingStage: 'completed',
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
        processingStage: 'completed',
      });
    }
  }

  private scheduleGraphSync(input: {
    documentId: string;
    knowledgeId: string;
    source: string;
    rows: KnowledgeDocumentChunkRow[];
  }): void {
    void this.syncGraphBestEffort(input);
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

  private async cleanupDocument(
    documentId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.elasticsearchService.safeDeleteByDocumentId(
        documentId,
        reason,
      );
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
      await this.cleanupDocument(documentId, `导入失败清理文档 ${documentId}`);
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
    const document = await this.documentRepo.save(
      this.documentRepo.create({
        knowledgeBaseId: knowledgeId,
        filename: file.originalname,
        status: 'processing',
        processingStage: 'uploaded',
        processingError: null,
        mimeType: file.mimetype,
        fileSize: file.size,
      }),
    );

    try {
      await this.updateDocumentStage(document.id, 'parsing');
      const content = await this.extractDocumentText(file);
      return this.ingestPreparedDocument(
        document,
        knowledgeId,
        file.originalname,
        content,
        {
          mimeType: file.mimetype,
          fileSize: file.size,
          category,
        },
      );
    } catch (error) {
      await this.cleanupFailedIngest(document.id);
      await this.documentRepo.update(document.id, {
        status: 'failed',
        chunkCount: 0,
        processingStage: 'failed',
        processingError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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

  private updateDocumentStage(
    documentId: string,
    processingStage: DocumentProcessingStage,
  ): Promise<unknown> {
    return this.documentRepo.update(documentId, {
      status: processingStage === 'failed' ? 'failed' : 'processing',
      processingStage,
      processingError: null,
    });
  }
}
