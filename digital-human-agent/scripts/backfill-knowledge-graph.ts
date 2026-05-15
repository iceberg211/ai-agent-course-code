import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { redactDatabaseUrl } from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';
import {
  buildKnowledgeGraphBackfillConnectionWarnings,
  resolveKnowledgeGraphBackfillOptions,
} from '@/knowledge-content/graph/knowledge-graph-backfill-options';
import { assertKnowledgeGraphBackfillDatabaseReady } from '@/knowledge-content/graph/knowledge-graph-backfill-preflight';
import { KnowledgeGraphBackfillService } from '@/knowledge-content/graph/knowledge-graph-backfill.service';

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
  const options = resolveKnowledgeGraphBackfillOptions(process.argv.slice(2), {
    ...fileEnv,
    ...process.env,
  });
  const databaseUrl = envValue('DATABASE_URL');
  const warnings = buildKnowledgeGraphBackfillConnectionWarnings(databaseUrl);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'graph-backfill',
          dryRun: true,
          pageSize: options.pageSize,
          extractorVersion: options.extractorVersion,
          schemaVersion: options.schemaVersion,
          database: redactDatabaseUrl(databaseUrl),
          warnings,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const warning of warnings) {
    console.warn(`Graph RAG 回填连接警告：${warning}`);
  }

  await assertKnowledgeGraphBackfillDatabaseReady(databaseUrl);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const backfillService = app.get(KnowledgeGraphBackfillService);
    const summary = await backfillService.backfillAll(options.pageSize, {
      extractorVersion: options.extractorVersion,
      schemaVersion: options.schemaVersion,
    });

    console.log(
      `Graph RAG 回填完成：pageCount=${summary.pageCount} documentCount=${summary.documentCount} chunkCount=${summary.chunkCount} staleDocumentCount=${summary.staleDocumentCount}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `Graph RAG 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
