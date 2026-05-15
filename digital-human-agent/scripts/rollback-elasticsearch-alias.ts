import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  buildRollbackAliasActions,
  buildRollbackAliasRefusalReasons,
  resolveRollbackAliasIndexes,
} from '@/knowledge-content/elasticsearch/elasticsearch-alias-actions';
import { formatElasticsearchError } from '@/knowledge-content/elasticsearch/elasticsearch-error-format';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { ElasticsearchScriptModule } from './elasticsearch-script.module';

function readRequiredArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) {
    throw new Error(`缺少参数 --${name}=...`);
  }
  return value;
}

function readOptionalArg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return value || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const fromVersion = readOptionalArg('from');
  const targetVersion = readRequiredArg('to');
  const dryRun = hasFlag('dry-run');
  const app = await NestFactory.createApplicationContext(ElasticsearchScriptModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const indexService = app.get(ElasticsearchIndexService);
    const client = indexService.getClient();
    if (!client || !indexService.isEnabled()) {
      throw new Error('ES 未启用，无法回滚 alias');
    }

    const currentIndex = indexService.getKnowledgeChunkIndexName();
    const { fromIndex, targetIndex } = resolveRollbackAliasIndexes({
      currentIndex,
      fromVersion,
      toVersion: targetVersion,
    });
    const readAlias = indexService.getKnowledgeChunkReadAlias();
    const writeAlias = indexService.getKnowledgeChunkWriteAlias();

    const targetExists = await client.indices.exists({ index: targetIndex });
    const before = await client.indices.getAlias({
      name: `${readAlias},${writeAlias}`,
      ignore_unavailable: true,
    });
    const currentAliasIndexes = Object.keys(before);
    const refusalReasons = buildRollbackAliasRefusalReasons({
      targetIndex,
      targetExists,
    });
    const actions = buildRollbackAliasActions({
      currentAliasIndexes,
      targetIndex,
      readAlias,
      writeAlias,
    });

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            action: 'rollback-elasticsearch-alias',
            dryRun: true,
            from: fromIndex,
            to: targetIndex,
            targetExists,
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
      throw new Error(`目标回滚索引不存在：${targetIndex}`);
    }
    if (refusalReasons.length > 0) {
      throw new Error(`ES alias 回滚前置检查失败：${refusalReasons.join('；')}`);
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
          action: 'rollback-elasticsearch-alias',
          from: fromIndex,
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
  console.error(`ES alias 回滚失败：${formatElasticsearchError(error)}`);
  process.exit(1);
});
