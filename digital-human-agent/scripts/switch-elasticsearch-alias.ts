import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';

function readRequiredArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) {
    throw new Error(`缺少参数 --${name}=...`);
  }
  return value;
}

function replaceVersion(indexName: string, version: string): string {
  return indexName.replace(/-[^-]+$/, `-${version}`);
}

async function main(): Promise<void> {
  const fromVersion = readRequiredArg('from');
  const toVersion = readRequiredArg('to');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const indexService = app.get(ElasticsearchIndexService);
    const client = indexService.getClient();
    if (!client || !indexService.isEnabled()) {
      throw new Error('ES 未启用，无法切换 alias');
    }

    const currentIndex = indexService.getKnowledgeChunkIndexName();
    const fromIndex = replaceVersion(currentIndex, fromVersion);
    const toIndex = replaceVersion(currentIndex, toVersion);
    const readAlias = indexService.getKnowledgeChunkReadAlias();
    const writeAlias = indexService.getKnowledgeChunkWriteAlias();

    const [targetExists, health, count] = await Promise.all([
      client.indices.exists({ index: toIndex }),
      client.cluster.health({ index: toIndex }),
      client.count({ index: toIndex }),
    ]);

    if (!targetExists) {
      throw new Error(`目标索引不存在：${toIndex}`);
    }
    if (count.count <= 0) {
      throw new Error(`目标索引没有文档，拒绝切换：${toIndex}`);
    }
    if (health.status === 'red') {
      throw new Error(`目标索引 health=red，拒绝切换：${toIndex}`);
    }

    const before = await client.indices.getAlias({
      name: `${readAlias},${writeAlias}`,
      ignore_unavailable: true,
    });

    await client.indices.updateAliases({
      actions: [
        { remove: { index: fromIndex, alias: readAlias, must_exist: false } },
        { remove: { index: fromIndex, alias: writeAlias, must_exist: false } },
        { add: { index: toIndex, alias: readAlias } },
        { add: { index: toIndex, alias: writeAlias, is_write_index: true } },
      ],
    });

    const after = await client.indices.getAlias({
      name: `${readAlias},${writeAlias}`,
      ignore_unavailable: true,
    });

    console.log(
      JSON.stringify(
        {
          action: 'switch-elasticsearch-alias',
          from: fromIndex,
          to: toIndex,
          documentCount: count.count,
          health: health.status,
          before,
          after,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `ES alias 切换失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
