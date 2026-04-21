import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import {
  DEFAULT_ELASTICSEARCH_INDEX_PREFIX,
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  ELASTICSEARCH_CLIENT,
} from '@/common/constants';

@Injectable()
export class ElasticsearchIndexService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchIndexService.name);
  private readonly enabled: boolean;
  private readonly indexPrefix: string;
  private readonly indexVersion: string;

  constructor(
    @Optional()
    @Inject(ELASTICSEARCH_CLIENT)
    private readonly client: Client | null,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.readBoolean('ELASTICSEARCH_ENABLED', false);
    this.indexPrefix =
      this.readString('ELASTICSEARCH_INDEX_PREFIX') ||
      DEFAULT_ELASTICSEARCH_INDEX_PREFIX;
    this.indexVersion = DEFAULT_ELASTICSEARCH_INDEX_VERSION;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.ensureKnowledgeChunkIndex();
    } catch (error) {
      this.logger.warn(
        `ES 索引初始化失败，当前先跳过：${
          error instanceof Error ? error.message : String(error)
        }`,
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

  private readString(key: string): string {
    return String(this.configService.get<string>(key) ?? '').trim();
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const rawValue = this.readString(key);
    if (!rawValue) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase());
  }
}
