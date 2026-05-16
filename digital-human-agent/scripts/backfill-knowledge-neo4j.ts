import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { Neo4jGraphBackfillService } from '@/knowledge-content/graph/neo4j-graph-backfill.service';
import { Neo4jGraphSyncService } from '@/knowledge-content/graph/neo4j-graph-sync.service';

interface Neo4jBackfillOptions {
  dryRun: boolean;
  pageSize: number;
}

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
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

function resolveOptions(argv: string[]): Neo4jBackfillOptions {
  const pageSizeArg = argv.find((arg) => arg.startsWith('--page-size='));
  const pageSize = Number(pageSizeArg?.split('=')[1]);
  return {
    dryRun: argv.includes('--dry-run'),
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : 25,
  };
}

async function main(): Promise<void> {
  process.env.NEO4J_GRAPH_ENABLED = 'true';
  const options = resolveOptions(process.argv.slice(2));

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'neo4j-backfill',
          dryRun: true,
          pageSize: options.pageSize,
          neo4jUrl: process.env.NEO4J_URL || 'bolt://localhost:7687',
          database: process.env.NEO4J_DATABASE || 'neo4j',
        },
        null,
        2,
      ),
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const graphSync = app.get(Neo4jGraphSyncService);
    await graphSync.ensureSchema();

    const backfillService = app.get(Neo4jGraphBackfillService);
    const summary = await backfillService.backfillAll(options.pageSize);
    console.log(
      `Neo4j 回填完成：pageCount=${summary.pageCount} documentCount=${summary.documentCount} chunkCount=${summary.chunkCount}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `Neo4j 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
