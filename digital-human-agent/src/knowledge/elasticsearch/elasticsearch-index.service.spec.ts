import { ConfigService } from '@nestjs/config';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';

describe('ElasticsearchIndexService', () => {
  function createService(env: Record<string, string> = {}) {
    const client = {
      indices: {
        exists: jest.fn().mockResolvedValue(false),
        create: jest.fn().mockResolvedValue(undefined),
        existsAlias: jest.fn().mockResolvedValue(false),
        putAlias: jest.fn().mockResolvedValue(undefined),
        getAlias: jest.fn().mockResolvedValue({}),
      },
      ping: jest.fn().mockResolvedValue(true),
    };
    const configService = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    const chunkRepo = {
      createQueryBuilder: jest.fn(),
    } as any;

    const service = new ElasticsearchIndexService(client as never, configService, chunkRepo);

    return {
      service,
      client,
    };
  }

  it('默认创建 v2 索引，并使用 IK 中文分词 analyzer', async () => {
    const { service, client } = createService({
      ELASTICSEARCH_ENABLED: 'true',
      ELASTICSEARCH_INDEX_PREFIX: 'digital-human',
    });

    expect(service.getKnowledgeChunkIndexName()).toBe(
      'digital-human-knowledge-chunk-v2',
    );

    await service.ensureKnowledgeChunkIndex();

    expect(client.indices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'digital-human-knowledge-chunk-v2',
        settings: expect.objectContaining({
          analysis: expect.objectContaining({
            analyzer: expect.objectContaining({
              knowledge_content_ik_analyzer: expect.objectContaining({
                tokenizer: 'ik_max_word',
              }),
              knowledge_content_ik_search_analyzer: expect.objectContaining({
                tokenizer: 'ik_smart',
              }),
            }),
          }),
        }),
        mappings: expect.objectContaining({
          properties: expect.objectContaining({
            content: expect.objectContaining({
              analyzer: 'knowledge_content_ik_analyzer',
              search_analyzer: 'knowledge_content_ik_search_analyzer',
            }),
          }),
        }),
      }),
    );
  });

  it('允许通过 ELASTICSEARCH_INDEX_VERSION 指定回填目标索引版本', () => {
    const { service } = createService({
      ELASTICSEARCH_ENABLED: 'true',
      ELASTICSEARCH_INDEX_VERSION: 'v3',
    });

    expect(service.getKnowledgeChunkIndexName()).toBe(
      'digital-human-knowledge-chunk-v3',
    );
  });

  it('已有 alias 指向旧索引时不会自动切换到新索引', async () => {
    const { service, client } = createService({
      ELASTICSEARCH_ENABLED: 'true',
      ELASTICSEARCH_INDEX_PREFIX: 'digital-human',
      ELASTICSEARCH_INDEX_VERSION: 'v2',
    });
    client.indices.exists.mockResolvedValue(true);
    client.indices.existsAlias.mockResolvedValue(true);
    client.indices.getAlias.mockResolvedValue({
      'digital-human-knowledge-chunk-v1': {
        aliases: {
          'digital-human-knowledge-chunk-read': {},
          'digital-human-knowledge-chunk-write': { is_write_index: true },
        },
      },
    });

    await service.ensureKnowledgeChunkIndex();

    expect(client.indices.create).not.toHaveBeenCalled();
    expect(client.indices.putAlias).not.toHaveBeenCalled();
    expect(client.indices.getAlias).toHaveBeenCalledTimes(2);
    expect(client.indices.getAlias).toHaveBeenCalledWith({
      name: 'digital-human-knowledge-chunk-read',
    });
    expect(client.indices.getAlias).toHaveBeenCalledWith({
      name: 'digital-human-knowledge-chunk-write',
    });
  });
});
