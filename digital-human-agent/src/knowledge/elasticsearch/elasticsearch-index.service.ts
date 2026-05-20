import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Client } from '@elastic/elasticsearch';
import { KNOWLEDGE_INDEX_SETTINGS, KNOWLEDGE_INDEX_MAPPINGS } from './elasticsearch.config';
import {
  DEFAULT_ELASTICSEARCH_INDEX_PREFIX,
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  ELASTICSEARCH_CLIENT,
} from '@/common/constants';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import {
  KnowledgeChunkIndexDocument,
  KnowledgeChunkIndexRow,
  KnowledgeChunkIndexCursor,
} from './elasticsearch.types';
import { formatElasticsearchError } from './error-format';
import { elasticsearchProvider } from './elasticsearch.provider';

export { elasticsearchProvider };
export type {
  KnowledgeChunkIndexDocument,
  KnowledgeChunkIndexRow,
  KnowledgeChunkIndexCursor,
};

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class ElasticsearchIndexService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchIndexService.name);
  private readonly enabled: boolean;
  private readonly indexPrefix: string;
  private readonly indexVersion: string;
  private indexEnsured = false;

  constructor(
    @Optional()
    @Inject(ELASTICSEARCH_CLIENT)
    private readonly client: Client | null,
    private readonly configService: ConfigService,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
  ) {
    this.enabled = this.readBoolean('ELASTICSEARCH_ENABLED', false);
    this.indexPrefix =
      this.readString('ELASTICSEARCH_INDEX_PREFIX') ||
      DEFAULT_ELASTICSEARCH_INDEX_PREFIX;
    this.indexVersion =
      this.readString('ELASTICSEARCH_INDEX_VERSION') ||
      DEFAULT_ELASTICSEARCH_INDEX_VERSION;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.ensureKnowledgeChunkIndex();
    } catch (error) {
      this.logger.warn(
        `ES 索引初始化失败，当前先跳过：${formatElasticsearchError(error)}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  getClient(): Client | null {
    return this.client;
  }

  getKnowledgeChunkIndexName(): string {
    return `${this.indexPrefix}-knowledge-chunk-${this.indexVersion}`;
  }

  getKnowledgeChunkReadAlias(): string {
    return `${this.indexPrefix}-knowledge-chunk-read`;
  }

  getKnowledgeChunkWriteAlias(): string {
    return `${this.indexPrefix}-knowledge-chunk-write`;
  }

  async ensureKnowledgeChunkIndex(): Promise<void> {
    if (!this.client) return;
    if (this.indexEnsured) return;

    const indexName = this.getKnowledgeChunkIndexName();
    const exists = await this.client.indices.exists({ index: indexName });
    if (!exists) {
      await this.client.indices.create({
        index: indexName,
        settings: KNOWLEDGE_INDEX_SETTINGS,
        mappings: KNOWLEDGE_INDEX_MAPPINGS,
      });
      this.logger.log(`ES 索引已创建：${indexName}`);
    }

    await this.ensureAlias(this.getKnowledgeChunkReadAlias(), indexName);
    await this.ensureAlias(this.getKnowledgeChunkWriteAlias(), indexName, true);
    this.indexEnsured = true;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    return this.client.ping();
  }

  private async ensureAlias(
    aliasName: string,
    indexName: string,
    isWriteIndex = false,
  ): Promise<void> {
    if (!this.client) return;

    const aliasExists = await this.client.indices.existsAlias({
      name: aliasName,
    });
    if (!aliasExists) {
      await this.client.indices.putAlias({
        index: indexName,
        name: aliasName,
        is_write_index: isWriteIndex || undefined,
      });
      return;
    }

    const aliasMap = await this.client.indices.getAlias({ name: aliasName });
    if (aliasMap[indexName]) {
      return;
    }

    this.logger.warn(
      `ES 别名 ${aliasName} 已存在但未指向 ${indexName}，当前不自动切换，请手工确认 alias`,
    );
  }

  // ==========================================
  // 批量更新与同步操作 (原本在 elasticsearch-sync.service.ts)
  // ==========================================

  async bulkUpsertChunkDocuments(
    documents: KnowledgeChunkIndexDocument[],
  ): Promise<void> {
    await this.bulkUpsertChunkDocumentsToIndex(
      documents,
      this.getKnowledgeChunkWriteAlias(),
      false,
    );
  }

  async bulkUpsertChunkDocumentsToIndex(
    documents: KnowledgeChunkIndexDocument[],
    indexName: string,
    waitForRefresh = false,
  ): Promise<void> {
    if (documents.length === 0) return;

    const client = this.getClient();
    if (!client || !this.isEnabled()) return;

    await this.ensureKnowledgeChunkIndex();

    const operations = documents.flatMap((document) => [
      {
        update: {
          _index: indexName,
          _id: document.id,
        },
      },
      {
        doc: document,
        doc_as_upsert: true,
      },
    ]);

    const result = await client.bulk({
      refresh: waitForRefresh ? 'wait_for' : false,
      operations,
    });

    if (!result.errors) {
      return;
    }

    const failedItems = result.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => Boolean(item.update?.error))
      .slice(0, 5)
      .map(({ item, index }) => ({
        index,
        error: item.update?.error?.reason ?? 'unknown',
      }));

    throw new Error(
      `ES bulk upsert 失败，共 ${failedItems.length} 条报错：${JSON.stringify(
        failedItems,
      )}`,
    );
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    const client = this.getClient();
    if (!client || !this.isEnabled()) return;

    await client.deleteByQuery({
      index: this.getKnowledgeChunkWriteAlias(),
      refresh: false,
      query: {
        term: {
          document_id: documentId,
        },
      },
    });
  }

  async safeBulkUpsertChunkDocuments(
    documents: KnowledgeChunkIndexDocument[],
    context: string,
  ): Promise<void> {
    try {
      await this.bulkUpsertChunkDocuments(documents);
    } catch (error) {
      this.logger.warn(
        `${context} 同步 ES 失败，当前已忽略：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async safeDeleteByDocumentId(
    documentId: string,
    context: string,
  ): Promise<void> {
    try {
      await this.deleteByDocumentId(documentId);
    } catch (error) {
      this.logger.warn(
        `${context} 删除 ES 文档失败，当前已忽略：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ==========================================
  // TypeORM 数据库辅助查询 (原本在 knowledge-chunk-index-query.service.ts)
  // ==========================================

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

  private readString(key: string): string {
    return String(this.configService.get<string>(key) ?? '').trim();
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const rawValue = this.readString(key);
    if (!rawValue) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase());
  }
}
