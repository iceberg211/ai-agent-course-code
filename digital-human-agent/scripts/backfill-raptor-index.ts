import { existsSync, readFileSync } from 'node:fs';
import { redactDatabaseUrl } from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';
import {
  buildRagRaptorBackfillConnectionWarnings,
  resolveRagRaptorBackfillOptions,
} from '@/knowledge-content/raptor/rag-raptor-backfill-options';

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
          warnings,
          liveBackfillEnabled: false,
          blockedReason:
            'RAPTOR 真实回填需要摘要生成器、embedding 写入和 live eval 验证；当前只提供 schema、rollback、tree plan 与 dry-run。',
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(
    [
      'RAPTOR 真实回填尚未启用。',
      '当前已提供 schema、rollback、tree plan 和 dry-run。',
      '下一步需要接入摘要生成器、embedding 写入、索引状态更新和 live eval 后再开放非 dry-run。',
    ].join(' '),
  );
}

main().catch((error) => {
  console.error(
    `RAPTOR 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
