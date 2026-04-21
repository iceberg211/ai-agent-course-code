import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { KnowledgeChunk } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import {
  KnowledgeChunkIndexCursor,
  KnowledgeChunkIndexDocument,
} from '@/knowledge-content/elasticsearch/elasticsearch.types';

interface KnowledgeChunkIndexRow extends KnowledgeChunkIndexDocument {
  created_at: string;
}

@Injectable()
export class KnowledgeChunkIndexQueryService {
  constructor(
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
  ) {}

  async listByDocumentId(
    documentId: string,
  ): Promise<KnowledgeChunkIndexDocument[]> {
    const rows = await this.baseQueryBuilder()
      .where('chunk.document_id = :documentId', { documentId })
      .orderBy('chunk.chunk_index', 'ASC')
      .getRawMany<KnowledgeChunkIndexRow>();

    return rows.map((row) => this.toIndexDocument(row));
  }

  async findByChunkId(
    chunkId: string,
  ): Promise<KnowledgeChunkIndexDocument | null> {
    const row = await this.baseQueryBuilder()
      .where('chunk.id = :chunkId', { chunkId })
      .getRawOne<KnowledgeChunkIndexRow>();

    return row ? this.toIndexDocument(row) : null;
  }

  async listPage(
    pageSize: number,
    cursor?: KnowledgeChunkIndexCursor,
  ): Promise<{
    items: KnowledgeChunkIndexDocument[];
    nextCursor: KnowledgeChunkIndexCursor | null;
  }> {
    const builder = this.baseQueryBuilder()
      .orderBy('chunk.created_at', 'ASC')
      .addOrderBy('chunk.id', 'ASC')
      .limit(pageSize);

    if (cursor) {
      builder.andWhere(
        new Brackets((qb) => {
          qb.where('chunk.created_at > :cursorCreatedAt', {
            cursorCreatedAt: cursor.createdAt,
          }).orWhere(
            new Brackets((nestedQb) => {
              nestedQb
                .where('chunk.created_at = :cursorCreatedAt', {
                  cursorCreatedAt: cursor.createdAt,
                })
                .andWhere('chunk.id > :cursorId', {
                  cursorId: cursor.id,
                });
            }),
          );
        }),
      );
    }

    const rows = await builder.getRawMany<KnowledgeChunkIndexRow>();
    const items = rows.map((row) => this.toIndexDocument(row));
    const lastRow = rows.at(-1);

    return {
      items,
      nextCursor: lastRow
        ? {
            createdAt: lastRow.created_at,
            id: lastRow.id,
          }
        : null,
    };
  }

  private baseQueryBuilder() {
    return this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin(
        KnowledgeDocument,
        'document',
        'document.id = chunk.document_id',
      )
      .select('chunk.id', 'id')
      .addSelect('chunk.document_id', 'document_id')
      .addSelect('document.knowledge_base_id', 'knowledge_base_id')
      .addSelect('chunk.chunk_index', 'chunk_index')
      .addSelect('chunk.content', 'content')
      .addSelect('chunk.source', 'source')
      .addSelect('chunk.category', 'category')
      .addSelect('chunk.enabled', 'enabled')
      .addSelect('chunk.created_at', 'created_at');
  }

  private toIndexDocument(
    row: KnowledgeChunkIndexRow,
  ): KnowledgeChunkIndexDocument {
    return {
      id: row.id,
      document_id: row.document_id,
      knowledge_base_id: row.knowledge_base_id,
      chunk_index: Number(row.chunk_index),
      content: row.content,
      source: row.source,
      category: row.category,
      enabled: row.enabled === true || String(row.enabled) === 'true',
    };
  }
}
