import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { redactDatabaseUrl } from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';
import {
  buildKnowledgeParentChildBackfillConnectionWarnings,
  resolveKnowledgeParentChildBackfillOptions,
} from '@/knowledge-content/parent-child/knowledge-parent-child-backfill-options';
import { assertPostgresBackfillDatabaseReady } from '@/knowledge-content/backfill/postgres-backfill-preflight';
import { KnowledgeParentChildBackfillService } from '@/knowledge-content/parent-child/knowledge-parent-child-backfill.service';

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
  const options = resolveKnowledgeParentChildBackfillOptions(
    process.argv.slice(2),
    {
      ...fileEnv,
      ...process.env,
    },
  );

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'parent-child-backfill',
          dryRun: true,
          pageSize: options.pageSize,
          indexVersion: options.indexVersion,
          maxParentChars: options.maxParentChars,
          maxChildChunks: options.maxChildChunks,
          database: redactDatabaseUrl(envValue('DATABASE_URL')),
          warnings: buildKnowledgeParentChildBackfillConnectionWarnings(
            envValue('DATABASE_URL'),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const warning of buildKnowledgeParentChildBackfillConnectionWarnings(
    envValue('DATABASE_URL'),
  )) {
    console.warn(`Parent-Child 回填连接警告：${warning}`);
  }

  await assertPostgresBackfillDatabaseReady(envValue('DATABASE_URL'));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const backfillService = app.get(KnowledgeParentChildBackfillService);
    const summary = await backfillService.backfillAll(options.pageSize, {
      indexVersion: options.indexVersion,
      maxParentChars: options.maxParentChars,
      maxChildChunks: options.maxChildChunks,
    });

    console.log(
      `Parent-Child 回填完成：pageCount=${summary.pageCount} documentCount=${summary.documentCount} chunkCount=${summary.chunkCount} parentCount=${summary.parentCount} staleDocumentCount=${summary.staleDocumentCount}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `Parent-Child 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
