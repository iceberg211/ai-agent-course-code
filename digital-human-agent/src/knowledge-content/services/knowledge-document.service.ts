import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import {
  KnowledgeDocumentIndexSyncService,
  type KnowledgeDocumentChunkRow,
} from '@/knowledge-content/services/knowledge-document-index-sync.service';
import { splitKnowledgeDocumentContent } from '@/knowledge-content/services/knowledge-document-chunking.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type { IngestKnowledgeDocumentOptions } from '@/knowledge-content/types/knowledge-content.types';

type InsertChunkRow = KnowledgeDocumentChunkRow;

@Injectable()
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly documentIndexSyncService: KnowledgeDocumentIndexSyncService,
  ) {}

  async deleteDocument(documentId: string): Promise<void> {
    await this.documentRepo.delete(documentId);
    await this.documentIndexSyncService.cleanupDocument(
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
      })) satisfies InsertChunkRow[];

      await this.insertChunkRows(document.id, chunkRows);
      const graphSyncResult =
        await this.documentIndexSyncService.syncCreatedDocument({
          documentId: document.id,
          knowledgeId,
          source: filename,
          rows: chunkRows,
        });

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: splitDocuments.length,
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

    await this.documentIndexSyncService.syncChunkEnabled(
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

    await this.documentIndexSyncService.cleanupDocument(
      documentId,
      `导入失败清理文档 ${documentId}`,
    );
  }

}
