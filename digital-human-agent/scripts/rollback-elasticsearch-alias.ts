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
  const targetVersion = readRequiredArg('to');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const indexService = app.get(ElasticsearchIndexService);
    const client = indexService.getClient();
    if (!client || !indexService.isEnabled()) {
      throw new Error('ES 未启用，无法回滚 alias');
    }

    const currentIndex = indexService.getKnowledgeChunkIndexName();
    const targetIndex = replaceVersion(currentIndex, targetVersion);
    const readAlias = indexService.getKnowledgeChunkReadAlias();
    const writeAlias = indexService.getKnowledgeChunkWriteAlias();

    const targetExists = await client.indices.exists({ index: targetIndex });
    if (!targetExists) {
      throw new Error(`目标回滚索引不存在：${targetIndex}`);
    }

    const before = await client.indices.getAlias({
      name: `${readAlias},${writeAlias}`,
      ignore_unavailable: true,
    });
    const currentAliasIndexes = Object.keys(before);

    await client.indices.updateAliases({
      actions: [
        ...currentAliasIndexes.flatMap((index) => [
          { remove: { index, alias: readAlias, must_exist: false } },
          { remove: { index, alias: writeAlias, must_exist: false } },
        ]),
        { add: { index: targetIndex, alias: readAlias } },
        {
          add: {
            index: targetIndex,
            alias: writeAlias,
            is_write_index: true,
          },
        },
      ],
    });

    const after = await client.indices.getAlias({
      name: `${readAlias},${writeAlias}`,
      ignore_unavailable: true,
    });

    console.log(
      JSON.stringify(
        {
          action: 'rollback-elasticsearch-alias',
          to: targetIndex,
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
    `ES alias 回滚失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
