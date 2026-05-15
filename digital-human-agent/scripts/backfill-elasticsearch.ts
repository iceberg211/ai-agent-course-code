import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import {
  buildElasticsearchBackfillConnectionWarnings,
  resolveElasticsearchBackfillOptions,
} from '@/knowledge-content/elasticsearch/elasticsearch-backfill-options';
import { assertElasticsearchBackfillDatabaseReady } from '@/knowledge-content/elasticsearch/elasticsearch-backfill-preflight';
import { redactDatabaseUrl } from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';
import { KnowledgeElasticsearchBackfillService } from '@/knowledge-content/backfill/knowledge-elasticsearch-backfill.service';

function readDotEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync('.env')) return env;

  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = stripQuotes(match[2].trim());
  }
  return env;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

const fileEnv = readDotEnv();

function envValue(key: string): string {
  return String(process.env[key] ?? fileEnv[key] ?? '').trim();
}

async function main(): Promise<void> {
  const options = resolveElasticsearchBackfillOptions(process.argv.slice(2));
  const databaseUrl = envValue('DATABASE_URL');
  const connectionWarnings =
    buildElasticsearchBackfillConnectionWarnings(databaseUrl);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'es-backfill',
          dryRun: true,
          pageSize: options.pageSize,
          database: redactDatabaseUrl(databaseUrl),
          elasticsearch: {
            enabled: envValue('ELASTICSEARCH_ENABLED') || 'false',
            node: envValue('ELASTICSEARCH_URL') || 'http://localhost:9200',
            indexPrefix:
              envValue('ELASTICSEARCH_INDEX_PREFIX') || 'digital-human',
            indexVersion: envValue('ELASTICSEARCH_INDEX_VERSION') || 'v2',
          },
          warnings: connectionWarnings,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const warning of connectionWarnings) {
    console.warn(`ES 回填连接警告：${warning}`);
  }

  await assertElasticsearchBackfillDatabaseReady(envValue('DATABASE_URL'));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const backfillService = app.get(KnowledgeElasticsearchBackfillService);
    const summary = await backfillService.backfillAll(options.pageSize);

    console.log(
      `ES 回填完成：pageCount=${summary.pageCount} chunkCount=${summary.chunkCount}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `ES 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
