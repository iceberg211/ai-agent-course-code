import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/knowledge-document.entity';
import type { IngestKnowledgeDocumentOptions } from '@/knowledge-content/knowledge-content.types';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/knowledge-content-runtime.service';

@Injectable()
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly runtime: KnowledgeContentRuntimeService,
  ) {}

  async deleteDocument(documentId: string): Promise<void> {
    await this.documentRepo.delete(documentId);
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
      const splitDocuments = await this.runtime.splitter.createDocuments([content]);
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
        document_id: document.id,
        chunk_index: index,
        content: item.pageContent,
        source: filename,
        category: options.category ?? null,
        embedding: JSON.stringify(embeddings[index]),
      }));

      await this.insertChunkRows(document.id, chunkRows);

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: splitDocuments.length,
      });

      return this.documentRepo.findOneByOrFail({ id: document.id });
    } catch (error) {
      this.logger.error('Ingest failed', error);
      await this.documentRepo.update(document.id, { status: 'failed' });
      throw error;
    }
  }

  listDocumentsByKnowledgeId(knowledgeId: string): Promise<KnowledgeDocument[]> {
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
    const { error } = await this.runtime.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);

    if (error) {
      throw new Error(error.message);
    }
  }

  private async insertChunkRows(
    documentId: string,
    rows: Array<Record<string, string | number | null>>,
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
}
