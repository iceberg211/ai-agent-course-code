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
import type { estypes } from '@elastic/elasticsearch';
import {
  DEFAULT_ELASTICSEARCH_INDEX_PREFIX,
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  DEFAULT_ELASTICSEARCH_URL,
  ELASTICSEARCH_CLIENT,
} from '@/common/constants';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';

// ==========================================
// 类型与接口定义 (原本在 elasticsearch.types.ts 等)
// ==========================================

export interface KnowledgeChunkIndexDocument {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  source: string;
  category: string | null;
  enabled: boolean;
}

export interface KnowledgeChunkIndexCursor {
  createdAt: string;
  id: string;
}

export interface KnowledgeChunkIndexRow extends KnowledgeChunkIndexDocument {
  created_at: string;
}

export interface ElasticsearchAliasNames {
  readAlias: string;
  writeAlias: string;
}

export interface SwitchAliasActionInput extends ElasticsearchAliasNames {
  fromIndex: string;
  toIndex: string;
}

export interface RollbackAliasActionInput extends ElasticsearchAliasNames {
  currentAliasIndexes: string[];
  targetIndex: string;
}

export interface RollbackAliasRefusalInput {
  targetIndex: string;
  targetExists: boolean;
}

export interface RollbackAliasIndexInput {
  currentIndex: string;
  fromVersion?: string | null;
  toVersion: string;
}

export interface RollbackAliasIndexes {
  fromIndex: string | null;
  targetIndex: string;
}

export type ElasticsearchAliasMap = Record<
  string,
  {
    aliases?: Record<string, { is_write_index?: boolean }>;
  }
>;

export interface SwitchAliasRefusalInput extends SwitchAliasActionInput {
  beforeAliasMap: ElasticsearchAliasMap;
  targetExists: boolean;
  documentCount: number | null;
  healthStatus: string | null;
}

export type ElasticsearchAliasAction =
  | {
      remove: {
        index: string;
        alias: string;
        must_exist: false;
      };
    }
  | {
      add: {
        index: string;
        alias: string;
        is_write_index?: true;
      };
    };

// ==========================================
// 别名切换与版本处理函数 (原本在 alias-actions.ts)
// ==========================================

export function replaceElasticsearchIndexVersion(
  indexName: string,
  version: string,
): string {
  const normalizedVersion = version.trim();
  if (!/^v\d+$/.test(normalizedVersion)) {
    throw new Error(`ES 索引版本必须形如 v2：${version}`);
  }
  if (!/-v\d+$/.test(indexName)) {
    throw new Error(`ES 索引名缺少版本后缀：${indexName}`);
  }

  return indexName.replace(/-v\d+$/, `-${normalizedVersion}`);
}

export function buildSwitchAliasActions(
  input: SwitchAliasActionInput,
): ElasticsearchAliasAction[] {
  return [
    {
      remove: {
        index: input.fromIndex,
        alias: input.readAlias,
        must_exist: false,
      },
    },
    {
      remove: {
        index: input.fromIndex,
        alias: input.writeAlias,
        must_exist: false,
      },
    },
    {
      add: {
        index: input.toIndex,
        alias: input.readAlias,
      },
    },
    {
      add: {
        index: input.toIndex,
        alias: input.writeAlias,
        is_write_index: true,
      },
    },
  ];
}

function findAliasIndexes(
  aliasMap: ElasticsearchAliasMap,
  aliasName: string,
): string[] {
  return Object.entries(aliasMap)
    .filter(([, value]) => Boolean(value.aliases?.[aliasName]))
    .map(([index]) => index);
}

function formatAliasIndexes(indexes: string[]): string {
  return indexes.length > 0 ? indexes.join(',') : 'none';
}

function isOnlyAliasIndex(indexes: string[], expectedIndex: string): boolean {
  return indexes.length === 1 && indexes[0] === expectedIndex;
}

function isWriteIndexAlias(
  aliasMap: ElasticsearchAliasMap,
  indexName: string,
  aliasName: string,
): boolean {
  return aliasMap[indexName]?.aliases?.[aliasName]?.is_write_index === true;
}

export function buildSwitchAliasRefusalReasons(
  input: SwitchAliasRefusalInput,
): string[] {
  const readAliasIndexes = findAliasIndexes(
    input.beforeAliasMap,
    input.readAlias,
  );
  const writeAliasIndexes = findAliasIndexes(
    input.beforeAliasMap,
    input.writeAlias,
  );

  return [
    input.fromIndex === input.toIndex
      ? `来源索引和目标索引不能相同：${input.fromIndex}`
      : null,
    !input.targetExists ? `目标索引不存在：${input.toIndex}` : null,
    input.targetExists && (input.documentCount ?? 0) <= 0
      ? `目标索引没有文档，拒绝切换：${input.toIndex}`
      : null,
    input.healthStatus === 'red'
      ? `目标索引 health=red，拒绝切换：${input.toIndex}`
      : null,
    !isOnlyAliasIndex(readAliasIndexes, input.fromIndex)
      ? `read alias 必须唯一指向来源索引：${input.readAlias} current=${formatAliasIndexes(
          readAliasIndexes,
        )} expected=${input.fromIndex}`
      : null,
    !isOnlyAliasIndex(writeAliasIndexes, input.fromIndex)
      ? `write alias 必须唯一指向来源索引：${input.writeAlias} current=${formatAliasIndexes(
          writeAliasIndexes,
        )} expected=${input.fromIndex}`
      : null,
    isOnlyAliasIndex(writeAliasIndexes, input.fromIndex) &&
    !isWriteIndexAlias(input.beforeAliasMap, input.fromIndex, input.writeAlias)
      ? `write alias 未标记为写入索引：${input.writeAlias} index=${input.fromIndex}`
      : null,
  ].filter((reason): reason is string => Boolean(reason));
}

export function buildRollbackAliasActions(
  input: RollbackAliasActionInput,
): ElasticsearchAliasAction[] {
  return [
    ...input.currentAliasIndexes.flatMap((index) => [
      {
        remove: {
          index,
          alias: input.readAlias,
          must_exist: false as const,
        },
      },
      {
        remove: {
          index,
          alias: input.writeAlias,
          must_exist: false as const,
        },
      },
    ]),
    {
      add: {
        index: input.targetIndex,
        alias: input.readAlias,
      },
    },
    {
      add: {
        index: input.targetIndex,
        alias: input.writeAlias,
        is_write_index: true,
      },
    },
  ];
}

export function buildRollbackAliasRefusalReasons(
  input: RollbackAliasRefusalInput,
): string[] {
  return [
    !input.targetExists ? `目标回滚索引不存在：${input.targetIndex}` : null,
  ].filter((reason): reason is string => Boolean(reason));
}

export function resolveRollbackAliasIndexes(
  input: RollbackAliasIndexInput,
): RollbackAliasIndexes {
  return {
    fromIndex: input.fromVersion
      ? replaceElasticsearchIndexVersion(input.currentIndex, input.fromVersion)
      : null,
    targetIndex: replaceElasticsearchIndexVersion(
      input.currentIndex,
      input.toVersion,
    ),
  };
}

// ==========================================
// 错误格式化逻辑 (原本在 error-format.ts)
// ==========================================

interface ElasticsearchErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  hostname?: unknown;
  cause?: unknown;
  meta?: {
    statusCode?: unknown;
    attempts?: unknown;
    body?: unknown;
    connection?: {
      url?: unknown;
    };
    request?: {
      params?: {
        method?: unknown;
        path?: unknown;
      };
    };
  };
}

export function formatElasticsearchError(error: unknown): string {
  const errorLike = error as ElasticsearchErrorLike;
  const parts = [
    readMessage(error),
    readNamedValue('name', errorLike.name, (value) => value !== 'Error'),
    readNamedValue('code', errorLike.code),
    readNamedValue('hostname', errorLike.hostname),
    readNamedValue('statusCode', errorLike.meta?.statusCode),
    readNamedValue('attempts', errorLike.meta?.attempts),
    readRequest(errorLike.meta?.request?.params),
    readNamedValue(
      'url',
      redactUrl(readString(errorLike.meta?.connection?.url)),
    ),
    readBodyError(errorLike.meta?.body),
    readCause(errorLike.cause),
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) {
    return Array.from(new Set(parts)).join(' ');
  }

  const fallback = String(error).trim();
  return fallback && fallback !== '[object Object]'
    ? fallback
    : 'unknown elasticsearch error';
}

function readMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const message = readString((error as ElasticsearchErrorLike)?.message);
  return message || null;
}

function readNamedValue(
  name: string,
  value: unknown,
  predicate: (value: string) => boolean = () => true,
): string | null {
  const stringValue = readString(value);
  if (!stringValue || !predicate(stringValue)) return null;
  return `${name}=${stringValue}`;
}

function readRequest(params?: { method?: unknown; path?: unknown }): string | null {
  const method = readString(params?.method);
  const path = readString(params?.path);
  if (!method && !path) return null;
  return `request=${[method, path].filter(Boolean).join(' ')}`;
}

function readBodyError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const errorBody = (body as { error?: unknown }).error;
  if (!errorBody) return null;
  if (typeof errorBody === 'string') {
    return `bodyError=${errorBody}`;
  }

  const type = readString((errorBody as { type?: unknown }).type);
  const reason = readString((errorBody as { reason?: unknown }).reason);
  const bodyMessage = [type, reason].filter(Boolean).join(' ');
  return bodyMessage ? `bodyError=${bodyMessage}` : null;
}

function readCause(cause: unknown): string | null {
  if (!cause) return null;
  const code = readString((cause as { code?: unknown }).code);
  const message =
    cause instanceof Error
      ? cause.message.trim()
      : readString((cause as { message?: unknown }).message);
  const text = [code, message].filter(Boolean).join(' ');
  return text ? `cause=${text}` : null;
}

function readString(value: unknown): string {
  if (value instanceof URL) {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function redactUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return rawUrl.replace(/\/\/[^/@\s]+@/, '//');
  }
}

// ==========================================
// Client Provider Factory (原本在 provider.ts)
// ==========================================

export const elasticsearchProvider = {
  provide: ELASTICSEARCH_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Client | null => {
    const enabled = String(
      configService.get<string>('ELASTICSEARCH_ENABLED') ?? '',
    )
      .trim()
      .toLowerCase();
    const isEnabled = ['1', 'true', 'yes', 'on'].includes(enabled);
    if (!isEnabled) {
      return null;
    }

    const node =
      (configService.get<string>('ELASTICSEARCH_URL') ??
        DEFAULT_ELASTICSEARCH_URL) ||
      DEFAULT_ELASTICSEARCH_URL;

    return new Client({
      node: node.trim(),
      maxRetries: 2,
      requestTimeout: 5000,
    });
  },
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
        settings: {
          index: {
            max_ngram_diff: 4,
          },
          analysis: {
            filter: {
              knowledge_content_ngram_filter: {
                type: 'ngram',
                min_gram: 2,
                max_gram: 6,
                preserve_original: true,
              },
            },
            analyzer: {
              knowledge_content_ik_analyzer: {
                type: 'custom',
                tokenizer: 'ik_max_word',
                filter: ['lowercase'],
              },
              knowledge_content_ik_search_analyzer: {
                type: 'custom',
                tokenizer: 'ik_smart',
                filter: ['lowercase'],
              },
              knowledge_content_ngram_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'knowledge_content_ngram_filter'],
              },
            },
          },
        },
        mappings: {
          dynamic: 'strict',
          properties: {
            id: { type: 'keyword' },
            document_id: { type: 'keyword' },
            knowledge_base_id: { type: 'keyword' },
            chunk_index: { type: 'integer' },
            enabled: { type: 'boolean' },
            content: {
              type: 'text',
              analyzer: 'knowledge_content_ik_analyzer',
              search_analyzer: 'knowledge_content_ik_search_analyzer',
              fields: {
                ngram: {
                  type: 'text',
                  analyzer: 'knowledge_content_ngram_analyzer',
                  search_analyzer: 'standard',
                },
              },
            },
            source: {
              type: 'text',
              fields: {
                keyword: { type: 'keyword', ignore_above: 512 },
              },
            },
            category: {
              type: 'text',
              fields: {
                keyword: { type: 'keyword', ignore_above: 256 },
              },
            },
          },
        },
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
