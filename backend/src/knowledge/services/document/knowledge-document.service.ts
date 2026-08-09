import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Optional,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
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
import { KnowledgeCacheRevisionService } from '@/common/rag/knowledge-cache-revision.service';
import type {
  IngestKnowledgeDocumentOptions,
  KnowledgeAccessScope,
} from '@/knowledge/types/knowledge-content.types';
import { splitKnowledgeDocumentContent } from './markdown-splitter';
import type { UploadDocumentDto } from '@/knowledge/dto/upload-document.dto';
import { NotificationService } from '@/notification/notification.service';
import { DocumentAsset } from '@/knowledge/entities/document-asset.entity';
import {
  ObjectStorageProviderToken,
  type ObjectStorageProvider,
} from '@/storage/object-storage.provider';
import {
  applyDocumentAccessScope,
  isDocumentVisibleToScope,
} from '@/knowledge/utils/document-access.util';
import {
  applyJsonbAnyTagFilter,
  normalizeStringList,
} from '@/knowledge/utils/document-filter.util';

import type {
  KnowledgeDocumentChunk,
  KnowledgeDocumentChunkRow,
} from '@/knowledge/types/knowledge-document.types';

type UploadMetadataInput =
  | string
  | (Omit<Partial<IngestKnowledgeDocumentOptions>, 'tags' | 'expiresAt'> & {
      category?: string;
      ownerId?: string | null;
      tags?: string | string[];
      department?: string | null;
      businessCategory?: string | null;
      visibility?: 'private' | 'department' | 'company';
      expiresAt?: string | Date | null;
      versionGroupId?: string | null;
      versionNo?: number;
      isCurrentVersion?: boolean;
      currentIngestRunId?: string | null;
      parseStrategy?: string | null;
      parserVersion?: string | null;
      assetCount?: number;
    })
  | UploadDocumentDto
  | undefined;

function resolveMarkdownReadMaxBytes(): number {
  const raw = Number(process.env.DOCUMENT_MARKDOWN_READ_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 20 * 1024 * 1024;
}

async function streamToString(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > maxBytes) {
      throw new BadRequestException(`Markdown 内容超过读取上限 ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

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
    @InjectRepository(DocumentAsset)
    private readonly assetRepo: Repository<DocumentAsset>,
    private readonly runtime: RagRuntimeService,
    private readonly elasticsearchService: ElasticsearchIndexService,
    private readonly graphService: KnowledgeGraphService,
    @Optional()
    private readonly notificationService?: NotificationService,
    @Optional()
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider?: ObjectStorageProvider,
    @Optional()
    private readonly knowledgeCacheRevisionService?: KnowledgeCacheRevisionService,
  ) {}

  // ==========================================
  // 删除文档与索引清理
  // ==========================================
  async deleteDocument(documentId: string): Promise<void> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
      select: { id: true, knowledgeBaseId: true },
    });
    await this.cleanupDocument(documentId, `删除文档 ${documentId}`);
    await this.documentRepo.delete(documentId);
    if (document?.knowledgeBaseId) {
      await this.knowledgeCacheRevisionService?.bumpRevision(
        document.knowledgeBaseId,
      );
    }
  }

  async deleteDocumentForKnowledge(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<void> {
    await this.findDocumentInKnowledgeOrThrow(knowledgeId, documentId, accessScope);
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
        ownerId: options.ownerId ?? null,
        tags: options.tags ?? [],
        department: options.department ?? null,
        businessCategory: options.businessCategory ?? null,
        visibility: options.visibility ?? 'company',
        expiresAt: options.expiresAt ?? null,
        versionGroupId: options.versionGroupId ?? null,
        versionNo: options.versionNo ?? 1,
        isCurrentVersion: options.isCurrentVersion ?? true,
        currentIngestRunId: options.currentIngestRunId ?? null,
        parseStrategy: options.parseStrategy ?? 'legacy_text_pdf',
        parserVersion: options.parserVersion ?? 'legacy-v1',
        assetCount: options.assetCount ?? 0,
      }),
    );

    if (!document.versionGroupId) {
      document.versionGroupId = document.id;
      await this.documentRepo.save(document);
    }

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

      await this.updateDocumentStage(document.id, 'embedding');
      this.logger.log(
        `[开始分批 Embedding] model=${this.runtime.embeddings.model} texts=${splitDocuments.length} batchSize=${this.ingestBatchSize}`,
      );
      const chunkRows = await this.persistChunkBatches({
        documentId: document.id,
        knowledgeId,
        filename,
        category: options.category ?? null,
        splitDocuments,
      });
      await this.updateDocumentStage(document.id, 'keyword_indexing');

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: splitDocuments.length,
        processingStage: 'graph_indexing',
        processingError: null,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      });
      await this.knowledgeCacheRevisionService?.bumpRevision(knowledgeId);

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
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument[]> {
    const qb = this.documentRepo
      .createQueryBuilder('document')
      .where('document.knowledge_base_id = :knowledgeId', { knowledgeId })
      .orderBy('document.createdAt', 'DESC');
    applyDocumentAccessScope(qb, 'document', accessScope);
    return qb.getMany();
  }

  async listDocumentsForKnowledge(
    knowledgeId: string,
    filters: {
      q?: string;
      status?: string;
      graphStatus?: string;
      processingStage?: string;
      tags?: string;
      department?: string;
      businessCategory?: string;
      visibility?: 'private' | 'department' | 'company';
      expiresBefore?: string;
      page?: number;
      pageSize?: number;
      accessScope?: KnowledgeAccessScope;
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
      .orderBy('document.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    applyDocumentAccessScope(qb, 'document', filters.accessScope);

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
    this.applyDocumentGovernanceFilters(qb, filters);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async batchRetryDocuments(
    knowledgeId: string,
    documentIds: string[],
    accessScope?: KnowledgeAccessScope,
  ): Promise<Array<{ documentId: string; success: boolean; error?: string }>> {
    return Promise.all(
      documentIds.map(async (documentId) => {
        try {
          await this.retryDocumentForKnowledge(knowledgeId, documentId, accessScope);
          return { documentId, success: true };
        } catch (err: any) {
          const error = err?.message || String(err);
          this.logger.error(
            `Failed to retry document ${documentId} in knowledge ${knowledgeId}: ${error}`,
          );
          return { documentId, success: false, error };
        }
      }),
    );
  }

  async listDocuments(
    filters: {
      q?: string;
      knowledgeBaseId?: string;
      fileType?: string;
      status?: string;
      graphStatus?: string;
      processingStage?: string;
      tags?: string;
      department?: string;
      businessCategory?: string;
      visibility?: 'private' | 'department' | 'company';
      expiresBefore?: string;
      page?: number;
      pageSize?: number;
      accessScope?: KnowledgeAccessScope;
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
      .orderBy('document.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    applyDocumentAccessScope(qb, 'document', filters.accessScope);

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
    this.applyDocumentGovernanceFilters(qb, filters);

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
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeChunkEntity[]> {
    await this.findDocumentInKnowledgeOrThrow(knowledgeId, documentId, accessScope);
    return this.listChunksByDocumentId(documentId);
  }

  async listAssetsByKnowledgeDocument(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<Array<DocumentAsset & { url: string | null }>> {
    await this.findDocumentInKnowledgeOrThrow(knowledgeId, documentId, accessScope);
    return this.listAssetsForDocument(documentId);
  }

  async listAssetsByDocumentId(
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<Array<DocumentAsset & { url: string | null }>> {
    await this.findDocumentOrThrow(documentId, accessScope);
    return this.listAssetsForDocument(documentId);
  }

  async getMarkdownForKnowledgeDocument(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<{
    documentId: string;
    filename: string;
    markdown: string;
    markdownStorageKey: string | null;
  }> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
    );
    return this.readDocumentMarkdown(document);
  }

  async getMarkdownByDocumentId(
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<{
    documentId: string;
    filename: string;
    markdown: string;
    markdownStorageKey: string | null;
  }> {
    const document = await this.findDocumentOrThrow(documentId, accessScope);
    return this.readDocumentMarkdown(document);
  }

  private async listAssetsForDocument(
    documentId: string,
  ): Promise<Array<DocumentAsset & { url: string | null }>> {
    const assets = await this.assetRepo.find({
      where: { documentId },
      order: { createdAt: 'ASC' },
    });

    const bucket = process.env.S3_BUCKET || 'enterprise-kb';
    return Promise.all(
      assets.map(async (asset) => {
        let url = asset.url ?? null;
        if (!url && this.storageProvider) {
          try {
            url = await this.storageProvider.createPresignedGetUrl({
              bucket,
              key: asset.storageKey,
              expiresInSeconds: 3600,
            });
          } catch (error) {
            this.logger.warn(
              `生成资产访问 URL 失败 asset=${asset.id}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        return Object.assign(asset, { url });
      }),
    );
  }

  private async readDocumentMarkdown(document: KnowledgeDocument): Promise<{
    documentId: string;
    filename: string;
    markdown: string;
    markdownStorageKey: string | null;
  }> {
    if (!document.markdownStorageKey) {
      throw new NotFoundException('该文档尚未生成 Markdown 解析结果');
    }
    if (!this.storageProvider) {
      throw new NotFoundException('对象存储服务未配置，无法读取 Markdown');
    }

    const bucket = process.env.S3_BUCKET || 'enterprise-kb';
    const stream = await this.storageProvider.getObject({
      bucket,
      key: document.markdownStorageKey,
    });
    return {
      documentId: document.id,
      filename: document.filename,
      markdown: await streamToString(stream, resolveMarkdownReadMaxBytes()),
      markdownStorageKey: document.markdownStorageKey,
    };
  }

  async getChunkContextForKnowledge(
    knowledgeId: string,
    documentId: string,
    chunkId: string,
    options: { before?: number; after?: number } = {},
    accessScope?: KnowledgeAccessScope,
  ) {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
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
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
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
    await this.knowledgeCacheRevisionService?.bumpRevision(knowledgeId);

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
  async updateChunkEnabled(
    chunkId: string,
    enabled: boolean,
    knownKnowledgeId?: string,
  ): Promise<void> {
    const context = `更新 chunk ${chunkId}`;
    const { error } = await this.runtime.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);

    if (error) {
      throw new Error(error.message);
    }

    await this.syncChunkEnabled(chunkId, enabled, context);
    const knowledgeId =
      knownKnowledgeId ?? (await this.findKnowledgeIdByChunkId(chunkId));
    if (knowledgeId) {
      await this.knowledgeCacheRevisionService?.bumpRevision(knowledgeId);
    }
  }

  async updateChunkEnabledForKnowledge(
    knowledgeId: string,
    chunkId: string,
    enabled: boolean,
    accessScope?: KnowledgeAccessScope,
  ): Promise<void> {
    await this.findChunkInKnowledgeOrThrow(knowledgeId, chunkId, accessScope);
    return this.updateChunkEnabled(chunkId, enabled, knowledgeId);
  }

  private async findKnowledgeIdByChunkId(
    chunkId: string,
  ): Promise<string | null> {
    if (!this.knowledgeCacheRevisionService) return null;
    const chunk = await this.chunkRepo.findOne({
      where: { id: chunkId },
      relations: { document: true },
    });
    return chunk?.document?.knowledgeBaseId ?? null;
  }

  private async findDocumentInKnowledgeOrThrow(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId, knowledgeBaseId: knowledgeId },
    });
    if (!document) {
      throw new NotFoundException('文档不属于当前知识库或不存在');
    }
    if (!isDocumentVisibleToScope(document, accessScope)) {
      throw new NotFoundException('文档不属于当前知识库或不存在');
    }
    return document;
  }

  private async findDocumentOrThrow(
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('文档不存在');
    }
    if (!isDocumentVisibleToScope(document, accessScope)) {
      throw new NotFoundException('文档不存在');
    }
    return document;
  }

  private async findChunkInKnowledgeOrThrow(
    knowledgeId: string,
    chunkId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<void> {
    const qb = this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin('chunk.document', 'document')
      .where('chunk.id = :chunkId', { chunkId })
      .andWhere('document.knowledge_base_id = :knowledgeId', { knowledgeId });
    applyDocumentAccessScope(qb, 'document', accessScope);
    const row = await qb.getOne();

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

  /**
   * 分批生成 embedding、写入 PG 并同步 ES。
   * 返回的 manifest 行不携带大向量，避免大文档同时驻留全部 number[] 与 JSON 向量字符串。
   */
  private async persistChunkBatches(input: {
    documentId: string;
    knowledgeId: string;
    filename: string;
    category: string | null;
    splitDocuments: KnowledgeDocumentChunk[];
  }): Promise<KnowledgeDocumentChunkRow[]> {
    const manifestRows: KnowledgeDocumentChunkRow[] = [];
    const batchSize = this.ingestBatchSize;

    for (
      let start = 0;
      start < input.splitDocuments.length;
      start += batchSize
    ) {
      const documents = input.splitDocuments.slice(start, start + batchSize);
      const embeddings = await this.runtime.embeddings.embedDocuments(
        documents.map((item) => item.pageContent),
      );
      if (embeddings.length !== documents.length) {
        throw new Error(
          `Embedding 返回数量不匹配：expected=${documents.length} actual=${embeddings.length}`,
        );
      }

      const rows = documents.map((item, offset) =>
        this.buildChunkRow({
          documentId: input.documentId,
          chunkIndex: start + offset,
          content: item.pageContent,
          filename: input.filename,
          category: input.category,
          embedding: embeddings[offset],
        }),
      );
      await this.insertChunkRows(input.documentId, rows);
      await this.syncDocumentIndex({
        documentId: input.documentId,
        knowledgeId: input.knowledgeId,
        rows,
      });

      manifestRows.push(
        ...rows.map((row) => ({
          ...row,
          embedding: '[]',
        })),
      );
    }

    this.logger.log(
      `[分批 Embedding 完成] doc=${input.documentId} chunks=${manifestRows.length}`,
    );
    return manifestRows;
  }

  private get ingestBatchSize(): number {
    return Math.max(
      1,
      Math.min(CHUNK_INSERT_BATCH_SIZE, this.runtime.embeddingBatchSize || 1),
    );
  }

  private buildChunkRow(input: {
    documentId: string;
    chunkIndex: number;
    content: string;
    filename: string;
    category: string | null;
    embedding: number[];
  }): KnowledgeDocumentChunkRow {
    const media = this.extractChunkMediaMetadata(input.content);
    return {
      id: randomUUID(),
      document_id: input.documentId,
      chunk_index: input.chunkIndex,
      content: input.content,
      source: input.filename,
      category: input.category,
      enabled: true,
      embedding: JSON.stringify(input.embedding),
      source_asset_key: media.sourceAssetKey,
      start_ms: media.startMs,
      end_ms: media.endMs,
    };
  }

  private extractChunkMediaMetadata(content: string): {
    sourceAssetKey: string | null;
    startMs: number | null;
    endMs: number | null;
  } {
    const assetMatch = content.match(/s3:\/\/[^/\s)]+\/([^\s)]+)/);
    const timeMatch = content.match(
      /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s*-\s*(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/,
    );

    return {
      sourceAssetKey: assetMatch?.[1] ?? null,
      startMs: timeMatch ? this.parseTimeTagToMs(timeMatch, 1) : null,
      endMs: timeMatch ? this.parseTimeTagToMs(timeMatch, 4) : null,
    };
  }

  private parseTimeTagToMs(match: RegExpMatchArray, offset: number): number {
    const minutes = Number(match[offset] ?? 0);
    const seconds = Number(match[offset + 1] ?? 0);
    const millis = Number(String(match[offset + 2] ?? '0').padEnd(3, '0'));
    return minutes * 60_000 + seconds * 1000 + millis;
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
        source_asset_key: row.source_asset_key ?? null,
        start_ms: row.start_ms ?? null,
        end_ms: row.end_ms ?? null,
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
      const document = await this.documentRepo.findOne({
        where: { id: input.documentId },
      });
      const fullChunks = await this.chunkRepo.find({
        where: { documentId: input.documentId },
        order: { chunkIndex: 'ASC' },
      });

      const graphSyncResult = await this.syncDocumentGraph({
        documentId: input.documentId,
        knowledgeId: input.knowledgeId,
        source: input.source,
        chunks: fullChunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          source: chunk.source,
          category: chunk.category,
          content: chunk.content,
          allowedUserIds: chunk.allowedUserIds,
          allowedRoleIds: chunk.allowedRoleIds,
          allowedDepartmentIds: chunk.allowedDepartmentIds,
          securityLevel: chunk.securityLevel,
          aclVersion: chunk.aclVersion,
        })),
        isCurrentVersion: document?.isCurrentVersion,
        isArchived: document?.archivedAt !== null,
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
      allowedUserIds?: string[] | null;
      allowedRoleIds?: string[] | null;
      allowedDepartmentIds?: string[] | null;
      securityLevel?: number | null;
      aclVersion?: number | null;
    }>;
    isCurrentVersion?: boolean;
    isArchived?: boolean;
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
  async createDocument(
    knowledgeId: string,
    filename: string,
    fileSize: number,
    mimeType: string,
    input: UploadMetadataInput = {},
  ): Promise<KnowledgeDocument> {
    const metadata = this.normalizeUploadMetadata(input);
    const document = await this.documentRepo.save(
      this.documentRepo.create({
        knowledgeBaseId: knowledgeId,
        filename,
        status: 'processing',
        processingStage: 'uploaded',
        processingError: null,
        mimeType,
        fileSize,
        ownerId: metadata.ownerId,
        tags: metadata.tags,
        department: metadata.department,
        businessCategory: metadata.businessCategory,
        visibility: metadata.visibility,
        expiresAt: metadata.expiresAt,
        versionGroupId: metadata.versionGroupId,
        versionNo: metadata.versionNo,
        isCurrentVersion: metadata.isCurrentVersion,
        currentIngestRunId: metadata.currentIngestRunId,
        parseStrategy: metadata.parseStrategy,
        parserVersion: metadata.parserVersion,
        assetCount: metadata.assetCount,
      }),
    );
    if (!document.versionGroupId) {
      document.versionGroupId = document.id;
      await this.documentRepo.save(document);
    }
    return document;
  }

  async parseAndIngestDocument(
    knowledgeId: string,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    input: UploadMetadataInput = {},
  ): Promise<KnowledgeDocument> {
    const metadata = this.normalizeUploadMetadata(input);
    const document = await this.createDocument(
      knowledgeId,
      file.originalname,
      file.size,
      file.mimetype,
      input,
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
          category: metadata.category,
          ownerId: metadata.ownerId,
          tags: metadata.tags,
          department: metadata.department,
          businessCategory: metadata.businessCategory,
          visibility: metadata.visibility,
          expiresAt: metadata.expiresAt,
          versionGroupId: document.versionGroupId,
          versionNo: document.versionNo,
          isCurrentVersion: document.isCurrentVersion,
          currentIngestRunId: document.currentIngestRunId,
          parseStrategy: document.parseStrategy,
          parserVersion: document.parserVersion,
          assetCount: document.assetCount,
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
      void this.notificationService?.create({
        type: 'document_failed',
        title: '文档处理失败',
        message: `${file.originalname} 处理失败`,
        payload: {
          knowledgeId,
          documentId: document.id,
          filename: file.originalname,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async uploadDocumentVersion(
    knowledgeId: string,
    baseDocumentId: string,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    input: UploadDocumentDto = {},
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const base = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      baseDocumentId,
      accessScope,
    );
    this.assertDocumentWritable(base, accessScope);
    const versionGroupId = base.versionGroupId ?? base.id;
    if (!base.versionGroupId) {
      await this.documentRepo.update(base.id, { versionGroupId });
    }
    const latest = await this.documentRepo.findOne({
      where: { knowledgeBaseId: knowledgeId, versionGroupId },
      order: { versionNo: 'DESC' },
    });
    const metadata = this.normalizeUploadMetadata(input, base);
    const document = await this.parseAndIngestDocument(knowledgeId, file, {
      ...metadata,
      versionGroupId,
      versionNo: (latest?.versionNo ?? base.versionNo ?? 1) + 1,
      isCurrentVersion: true,
    });
    await this.documentRepo
      .createQueryBuilder()
      .update(KnowledgeDocument)
      .set({ isCurrentVersion: false })
      .where('version_group_id = :versionGroupId', { versionGroupId })
      .andWhere('id != :documentId', { documentId: document.id })
      .execute();
    await this.cleanupNonCurrentVersionIndexes(
      knowledgeId,
      versionGroupId,
      document.id,
    );
    return this.documentRepo.findOneByOrFail({ id: document.id });
  }

  async listDocumentVersions(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument[]> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
    );
    const versionGroupId = document.versionGroupId ?? document.id;
    return this.documentRepo.find({
      where: { knowledgeBaseId: knowledgeId, versionGroupId },
      order: { versionNo: 'DESC', createdAt: 'DESC' },
    });
  }

  async setCurrentDocumentVersion(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
    );
    if (document.archivedAt) {
      throw new BadRequestException('归档版本不能设为当前版本');
    }
    const versionGroupId = document.versionGroupId ?? document.id;
    await this.documentRepo
      .createQueryBuilder()
      .update(KnowledgeDocument)
      .set({ isCurrentVersion: false })
      .where('version_group_id = :versionGroupId', { versionGroupId })
      .execute();
    await this.documentRepo.update(document.id, { isCurrentVersion: true });
    await this.cleanupNonCurrentVersionIndexes(
      knowledgeId,
      versionGroupId,
      document.id,
    );
    const chunks = await this.listChunksByDocumentId(document.id);
    await this.syncDocumentIndex({
      documentId: document.id,
      knowledgeId,
      rows: chunks.map((chunk) => ({
        id: chunk.id,
        document_id: document.id,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        source: chunk.source,
        category: chunk.category,
        enabled: chunk.enabled,
        embedding: '[]',
      })),
    });
    return this.documentRepo.findOneByOrFail({ id: document.id });
  }

  async archiveDocument(
    knowledgeId: string,
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
    );
    await this.documentRepo.update(document.id, {
      archivedAt: new Date(),
      isCurrentVersion: false,
    });
    await this.cleanupDocument(document.id, `归档文档 ${document.id}`);
    return this.documentRepo.findOneByOrFail({ id: document.id });
  }

  async updateDocumentGovernance(
    knowledgeId: string,
    documentId: string,
    input: UploadDocumentDto,
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeDocument> {
    const document = await this.findDocumentInKnowledgeOrThrow(
      knowledgeId,
      documentId,
      accessScope,
    );
    this.assertDocumentWritable(document, accessScope);
    const metadata = this.normalizeUploadMetadata(input, document);
    await this.documentRepo.update(document.id, {
      tags: metadata.tags,
      department: metadata.department,
      businessCategory: metadata.businessCategory,
      visibility: metadata.visibility,
      expiresAt: metadata.expiresAt,
    });
    return this.documentRepo.findOneByOrFail({ id: document.id });
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

  private applyDocumentGovernanceFilters(
    qb: {
      andWhere: (condition: string, parameters?: Record<string, unknown>) => unknown;
    },
    filters: {
      processingStage?: string;
      tags?: string;
      department?: string;
      businessCategory?: string;
      visibility?: 'private' | 'department' | 'company';
      expiresBefore?: string;
    },
  ): void {
    if (filters.processingStage) {
      qb.andWhere('document.processing_stage = :processingStage', {
        processingStage: filters.processingStage,
      });
    }
    const tags = this.parseTags(filters.tags);
    if (tags.length > 0) {
      applyJsonbAnyTagFilter(qb, 'document', tags);
    }
    if (filters.department) {
      qb.andWhere('document.department = :department', {
        department: filters.department,
      });
    }
    if (filters.businessCategory) {
      qb.andWhere('document.business_category = :businessCategory', {
        businessCategory: filters.businessCategory,
      });
    }
    if (filters.visibility) {
      qb.andWhere('document.visibility = :visibility', {
        visibility: filters.visibility,
      });
    }
    if (filters.expiresBefore) {
      const expiresBefore = new Date(filters.expiresBefore);
      if (!Number.isNaN(expiresBefore.getTime())) {
        qb.andWhere('document.expires_at IS NOT NULL');
        qb.andWhere('document.expires_at <= :expiresBefore', {
          expiresBefore,
        });
      }
    }
  }

  private normalizeUploadMetadata(
    input: UploadMetadataInput,
    fallback?: KnowledgeDocument,
  ): IngestKnowledgeDocumentOptions & {
    category?: string;
    ownerId: string | null;
    tags: string[];
    department: string | null;
    businessCategory: string | null;
    visibility: 'private' | 'department' | 'company';
    expiresAt: Date | null;
    versionGroupId: string | null;
    versionNo: number;
    isCurrentVersion: boolean;
    currentIngestRunId: string | null;
    parseStrategy: string | null;
    parserVersion: string | null;
    assetCount: number;
  } {
    const raw = (typeof input === 'string' ? { category: input } : (input ?? {})) as {
      category?: string;
      ownerId?: string | null;
      tags?: string | string[];
      department?: string | null;
      businessCategory?: string | null;
      visibility?: 'private' | 'department' | 'company';
      expiresAt?: string | Date | null;
      versionGroupId?: string | null;
      versionNo?: number;
      isCurrentVersion?: boolean;
      currentIngestRunId?: string | null;
      parseStrategy?: string | null;
      parserVersion?: string | null;
      assetCount?: number;
    };
    const expiresAt =
      typeof raw.expiresAt === 'object' && raw.expiresAt instanceof Date
        ? raw.expiresAt
        : raw.expiresAt
          ? new Date(raw.expiresAt)
          : fallback?.expiresAt ?? null;
    return {
      category: raw.category,
      ownerId: raw.ownerId ?? fallback?.ownerId ?? null,
      tags: Array.isArray(raw.tags)
        ? raw.tags
        : this.parseTags(raw.tags).length > 0
          ? this.parseTags(raw.tags)
          : fallback?.tags ?? [],
      department: raw.department ?? fallback?.department ?? null,
      businessCategory: raw.businessCategory ?? fallback?.businessCategory ?? null,
      visibility: raw.visibility ?? fallback?.visibility ?? 'company',
      expiresAt:
        expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      versionGroupId: raw.versionGroupId ?? fallback?.versionGroupId ?? null,
      versionNo: raw.versionNo ?? fallback?.versionNo ?? 1,
      isCurrentVersion: raw.isCurrentVersion ?? fallback?.isCurrentVersion ?? true,
      currentIngestRunId:
        raw.currentIngestRunId ?? fallback?.currentIngestRunId ?? null,
      parseStrategy:
        raw.parseStrategy ?? fallback?.parseStrategy ?? 'legacy_text_pdf',
      parserVersion: raw.parserVersion ?? fallback?.parserVersion ?? 'legacy-v1',
      assetCount: raw.assetCount ?? fallback?.assetCount ?? 0,
    };
  }

  private assertDocumentWritable(
    document: Pick<KnowledgeDocument, 'ownerId'>,
    accessScope?: KnowledgeAccessScope,
  ): void {
    if (!accessScope || accessScope.role === 'admin') return;
    if (accessScope.ownerId && document.ownerId === accessScope.ownerId) return;
    throw new ForbiddenException('无权修改该文档');
  }

  private parseTags(value?: string | string[]): string[] {
    return normalizeStringList(value);
  }

  private async cleanupNonCurrentVersionIndexes(
    knowledgeId: string,
    versionGroupId: string,
    currentDocumentId: string,
  ): Promise<void> {
    const versions = await this.documentRepo.find({
      where: { knowledgeBaseId: knowledgeId, versionGroupId },
    });
    await Promise.all(
      versions
        .filter((item) => item.id !== currentDocumentId)
        .map((item) =>
          this.cleanupDocument(
            item.id,
            `切换当前版本，清理旧版本 ${item.id}`,
          ),
        ),
    );
  }

  async parseDocument(file: {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<string> {
    return this.extractDocumentText(file);
  }

  async indexDocumentChunks(
    document: KnowledgeDocument,
    knowledgeId: string,
    filename: string,
    content: string,
    options: IngestKnowledgeDocumentOptions = {},
  ): Promise<KnowledgeDocumentChunkRow[]> {
    // 幂等清理旧的 chunk、ES 索引
    try {
      await this.chunkRepo.delete({ documentId: document.id });
      await this.elasticsearchService.safeDeleteByDocumentId(
        document.id,
        `重新索引幂等清理 docId=${document.id}`,
      );
    } catch (err) {
      this.logger.warn(`幂等清理旧索引失败 docId=${document.id}: ${err.message}`);
    }

    await this.updateDocumentStage(document.id, 'chunking');
    const splitDocuments = await splitKnowledgeDocumentContent(
      content,
      this.runtime.splitter,
    );
    this.logger.log(
      `[切分完成] filename=${filename} chunks=${splitDocuments.length}`,
    );

    await this.updateDocumentStage(document.id, 'embedding');
    this.logger.log(
      `[开始分批 Embedding] model=${this.runtime.embeddings.model} texts=${splitDocuments.length} batchSize=${this.ingestBatchSize}`,
    );
    const chunkRows = await this.persistChunkBatches({
      documentId: document.id,
      knowledgeId,
      filename,
      category: options.category ?? null,
      splitDocuments,
    });
    await this.updateDocumentStage(document.id, 'keyword_indexing');

    await this.documentRepo.update(document.id, {
      status: 'completed',
      chunkCount: splitDocuments.length,
      processingStage: 'completed',
      processingError: null,
    });
    await this.knowledgeCacheRevisionService?.bumpRevision(knowledgeId);

    return chunkRows;
  }

  findDocumentById(documentId: string): Promise<KnowledgeDocument | null> {
    return this.documentRepo.findOne({ where: { id: documentId } });
  }

  async updateDocumentAssetCount(
    documentId: string,
    assetCount: number,
  ): Promise<void> {
    await this.documentRepo.update(documentId, { assetCount });
  }

  async syncGraphOnly(
    document: KnowledgeDocument,
    knowledgeId: string,
    filename: string,
    chunkRows: KnowledgeDocumentChunkRow[],
  ): Promise<void> {
    try {
      await this.graphService.safeDeleteByDocumentId(
        document.id,
        `重新同步图谱幂等清理 docId=${document.id}`,
      );
    } catch (err) {
      this.logger.warn(`幂等清理图谱失败 docId=${document.id}: ${err.message}`);
    }

    await this.documentRepo.update(document.id, {
      processingStage: 'graph_indexing',
      graphSyncStatus: 'pending',
      graphSyncError: null,
    });

    const fullChunks = await this.chunkRepo.find({
      where: { documentId: document.id },
      order: { chunkIndex: 'ASC' },
    });

    const graphSyncResult = await this.syncDocumentGraph({
      documentId: document.id,
      knowledgeId,
      source: filename,
      chunks: fullChunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        source: chunk.source,
        category: chunk.category,
        content: chunk.content,
        allowedUserIds: chunk.allowedUserIds,
        allowedRoleIds: chunk.allowedRoleIds,
        allowedDepartmentIds: chunk.allowedDepartmentIds,
        securityLevel: chunk.securityLevel,
        aclVersion: chunk.aclVersion,
      })),
      isCurrentVersion: document.isCurrentVersion,
      isArchived: document.archivedAt !== null,
    });

    await this.documentRepo.update(document.id, {
      graphSyncStatus: graphSyncResult.status,
      graphSyncError:
        graphSyncResult.status === 'failed'
          ? graphSyncResult.errorMessage
          : null,
      graphSyncedAt: graphSyncResult.status === 'indexed' ? new Date() : null,
      processingStage: 'completed',
    });
  }

  async updateDocument(documentId: string, update: Partial<KnowledgeDocument>): Promise<void> {
    await this.documentRepo.update(documentId, update);
    if (!this.shouldInvalidateRetrievalCache(update)) return;
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
      select: { id: true, knowledgeBaseId: true },
    });
    if (document?.knowledgeBaseId) {
      await this.knowledgeCacheRevisionService?.bumpRevision(
        document.knowledgeBaseId,
      );
    }
  }

  private shouldInvalidateRetrievalCache(
    update: Partial<KnowledgeDocument>,
  ): boolean {
    const retrievalFields: Array<keyof KnowledgeDocument> = [
      'ownerId',
      'department',
      'businessCategory',
      'visibility',
      'expiresAt',
      'versionGroupId',
      'isCurrentVersion',
      'archivedAt',
    ];
    return retrievalFields.some((field) => field in update);
  }

  async findOneDocument(documentId: string): Promise<KnowledgeDocument | null> {
    return this.documentRepo.findOne({ where: { id: documentId } });
  }
}
