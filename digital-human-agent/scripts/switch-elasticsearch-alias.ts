import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  buildSwitchAliasActions,
  buildSwitchAliasRefusalReasons,
  replaceElasticsearchIndexVersion,
} from '@/knowledge/elasticsearch/elasticsearch-alias-actions';
import { formatElasticsearchError } from '@/knowledge/elasticsearch/elasticsearch-error-format';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { ElasticsearchScriptModule } from './elasticsearch-script.module';

function readRequiredArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) {
    throw new Error(`缺少参数 --${name}=...`);
  }
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const fromVersion = readRequiredArg('from');
  const toVersion = readRequiredArg('to');
  const dryRun = hasFlag('dry-run');
  const app = await NestFactory.createApplicationContext(ElasticsearchScriptModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const indexService = app.get(ElasticsearchIndexService);
    const client = indexService.getClient();
    if (!client || !indexService.isEnabled()) {
      throw new Error('ES 未启用，无法切换 alias');
    }

    const currentIndex = indexService.getKnowledgeChunkIndexName();
    const fromIndex = replaceElasticsearchIndexVersion(
      currentIndex,
      fromVersion,
    );
    const toIndex = replaceElasticsearchIndexVersion(currentIndex, toVersion);
    const readAlias = indexService.getKnowledgeChunkReadAlias();
    const writeAlias = indexService.getKnowledgeChunkWriteAlias();

    const targetExists = await client.indices.exists({ index: toIndex });
    const [health, count] = targetExists
      ? await Promise.all([
          client.cluster.health({ index: toIndex }),
          client.count({ index: toIndex }),
        ])
      : [null, null];
    const before = await client.indices.getAlias({
      name: `${readAlias},${writeAlias}`,
      ignore_unavailable: true,
    });
    const actions = buildSwitchAliasActions({
      fromIndex,
      toIndex,
      readAlias,
      writeAlias,
    });
    const refusalReasons = buildSwitchAliasRefusalReasons({
      fromIndex,
      toIndex,
      readAlias,
      writeAlias,
      targetExists,
      documentCount: count?.count ?? null,
      healthStatus: health?.status ?? null,
      beforeAliasMap: before,
    });

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            action: 'switch-elasticsearch-alias',
            dryRun: true,
            from: fromIndex,
            to: toIndex,
            targetExists,
            documentCount: count?.count ?? null,
            health: health?.status ?? null,
            ready: refusalReasons.length === 0,
            refusalReasons,
            before,
            actions,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!targetExists) {
      throw new Error(`目标索引不存在：${toIndex}`);
    }
    if (!count || !health) {
      throw new Error(`目标索引状态读取失败：${toIndex}`);
    }
    if (count.count <= 0) {
      throw new Error(`目标索引没有文档，拒绝切换：${toIndex}`);
    }
    if (health.status === 'red') {
      throw new Error(`目标索引 health=red，拒绝切换：${toIndex}`);
    }
    if (refusalReasons.length > 0) {
      throw new Error(`ES alias 切换前置检查失败：${refusalReasons.join('；')}`);
    }

    await client.indices.updateAliases({
      actions,
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
  console.error(`ES alias 切换失败：${formatElasticsearchError(error)}`);
  process.exit(1);
});
