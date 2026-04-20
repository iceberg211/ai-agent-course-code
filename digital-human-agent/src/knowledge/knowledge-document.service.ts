import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseClient } from '@supabase/supabase-js';
import { Repository } from 'typeorm';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { KnowledgeChunk } from './domain/knowledge-chunk.entity';
import { KnowledgeDocument } from './domain/knowledge-document.entity';

@Injectable()
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);
  private readonly embeddingBatchSize = this.toNumber(
    process.env.EMBEDDINGS_BATCH_SIZE,
    10,
    1,
    10,
  );
  private readonly embeddings = new OpenAIEmbeddings({
    model: process.env.EMBEDDINGS_MODEL_NAME ?? 'text-embedding-v3',
    batchSize: this.embeddingBatchSize,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ['\n\n', '\n', '。', '！', '？', '；', '，', ' '],
  });

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async deleteDocument(documentId: string): Promise<void> {
    await this.docRepo.delete(documentId);
  }

  async ingestDocument(
    kbId: string,
    filename: string,
    content: string,
    opts: { mimeType?: string; fileSize?: number; category?: string } = {},
  ): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.save(
      this.docRepo.create({
        knowledgeBaseId: kbId,
        filename,
        status: 'processing',
        mimeType: opts.mimeType ?? null,
        fileSize: opts.fileSize ?? null,
      }),
    );

    try {
      const chunks = await this.splitter.createDocuments([content]);
      this.logger.log(`[切分完成] filename=${filename} chunks=${chunks.length}`);

      const texts = chunks.map((chunk) => chunk.pageContent);
      this.logger.log(
        `[开始 Embedding] model=${this.embeddings.model} texts=${texts.length} batchSize=${this.embeddingBatchSize}`,
      );
      const embeddings = await this.embeddings.embedDocuments(texts);
      this.logger.log(`[Embedding 完成] dims=${embeddings[0]?.length}`);

      const rows = chunks.map((chunk, index) => ({
        document_id: doc.id,
        chunk_index: index,
        content: chunk.pageContent,
        source: filename,
        category: opts.category ?? null,
        embedding: JSON.stringify(embeddings[index]),
      }));
      this.logger.log(`[开始 Insert] rows=${rows.length}`);

      const batchSize = 50;
      for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize);
        const result = await this.withTransientRetry<{
          error: { message: string } | null;
        }>(
          `insert batch ${Math.floor(index / batchSize) + 1}`,
          async () => {
            const response = await this.supabase
              .from('knowledge_chunk')
              .insert(batch);
            return {
              error: response.error
                ? { message: response.error.message }
                : null,
            };
          },
          3,
        );
        if (result.error) {
          throw new Error(result.error.message);
        }
      }
      this.logger.log(
        `[Insert 完成] doc=${doc.id} batches=${Math.ceil(rows.length / batchSize)}`,
      );

      await this.docRepo.update(doc.id, {
        status: 'completed',
        chunkCount: chunks.length,
      });

      return this.docRepo.findOneBy({
        id: doc.id,
      }) as Promise<KnowledgeDocument>;
    } catch (error) {
      this.logger.error('Ingest failed', error);
      await this.docRepo.update(doc.id, { status: 'failed' });
      throw error;
    }
  }

  listDocumentsByKb(kbId: string): Promise<KnowledgeDocument[]> {
    return this.docRepo.find({
      where: { knowledgeBaseId: kbId },
      order: { createdAt: 'DESC' },
    });
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunk[]> {
    return this.chunkRepo
      .createQueryBuilder('c')
      .where('c.document_id = :documentId', { documentId })
      .orderBy('c.chunk_index', 'ASC')
      .getMany();
  }

  async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);
    if (error) {
      throw new Error(error.message);
    }
  }

  private isTransientError(error: unknown): boolean {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';
    return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|502|503|504|429/i.test(
      msg,
    );
  }

  private async withTransientRetry<T>(
    op: string,
    fn: () => Promise<T>,
    attempts = 2,
  ): Promise<T> {
    let lastError: unknown;
    for (let index = 1; index <= attempts; index += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isTransientError(error) || index === attempts) {
          break;
        }
        this.logger.warn(
          `${op} 第 ${index} 次失败，准备重试：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * index));
      }
    }
    throw lastError;
  }

  private toNumber(
    raw: unknown,
    defaultValue: number,
    min: number,
    max: number,
  ): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return defaultValue;
    return Math.min(max, Math.max(min, n));
  }
}
