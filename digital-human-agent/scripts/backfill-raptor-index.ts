import { existsSync, readFileSync } from 'node:fs';
import { redactDatabaseUrl } from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';
import {
  buildRagRaptorBackfillConnectionWarnings,
  resolveRagRaptorBackfillOptions,
} from '@/knowledge-content/raptor/rag-raptor-backfill-options';

const LIVE_BACKFILL_REFUSAL =
  'RAPTOR 回填第一阶段只支持 --dry-run；尚未接入摘要生成、embedding 写入、索引状态更新和检索接入。';

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

function main(): void {
  const options = resolveRagRaptorBackfillOptions(process.argv.slice(2), {
    ...fileEnv,
    ...process.env,
  });
  const databaseUrl = envValue('DATABASE_URL');
  const warnings = buildRagRaptorBackfillConnectionWarnings(databaseUrl);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'raptor-backfill',
          dryRun: true,
          pageSize: options.pageSize,
          fanout: options.fanout,
          maxLayers: options.maxLayers,
          summarizerVersion: options.summarizerVersion,
          schemaVersion: options.schemaVersion,
          summarizerModel: options.summarizerModel,
          database: redactDatabaseUrl(databaseUrl),
          liveBackfillEnabled: false,
          refusalReasons: [LIVE_BACKFILL_REFUSAL],
          warnings,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(LIVE_BACKFILL_REFUSAL);
}

try {
  main();
} catch (error) {
  console.error(
    `RAPTOR 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
