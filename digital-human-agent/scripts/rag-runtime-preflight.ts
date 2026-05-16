import { readFileSync, existsSync } from 'node:fs';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { Client as PgClient } from 'pg';
import { formatRagEvalError } from '@/knowledge-content/evaluation/rag-eval-report';
import {
  buildDatabaseHints,
  buildDerivedDirectUrl as buildDerivedDirectUrlFromEnv,
  buildPoolerCandidateUrl,
  buildPoolerCandidates as buildPoolerCandidatesFromEnv,
  redactPoolerCandidate,
  redactDatabaseUrl,
  redactRuntimeDiagnostic,
  redactSupabaseRestEndpoint,
  type PoolerCandidate,
} from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';

type CheckStatus = 'ok' | 'fail' | 'skip';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: Record<string, unknown>;
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

function envValue(key: string): string {
  return String(process.env[key] ?? fileEnv[key] ?? '').trim();
}

function booleanEnv(key: string, fallback = false): boolean {
  const value = envValue(key).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function hasValue(key: string): boolean {
  return envValue(key).length > 0;
}

function readArg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function databaseHints(): Record<string, unknown> {
  return buildDatabaseHints({
    supabaseUrl: envValue('SUPABASE_URL'),
    directUrl: envValue('DIRECT_URL'),
  });
}

function buildDerivedDirectUrl(): string | null {
  return buildDerivedDirectUrlFromEnv({
    databaseUrl: envValue('DATABASE_URL'),
    supabaseUrl: envValue('SUPABASE_URL'),
  });
}

function failDetail(error: unknown): Record<string, unknown> {
  return {
    message: redactRuntimeDiagnostic(formatRagEvalError(error)),
    code: (error as { code?: unknown })?.code,
    hostname: redactRuntimeDiagnostic((error as { hostname?: unknown })?.hostname),
  };
}

async function checkEnv(): Promise<CheckResult> {
  const required = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MODEL_NAME',
  ];
  const missing = required.filter((key) => !hasValue(key));
  const hasModelKey = hasValue('OPENAI_API_KEY');

  return {
    name: 'env',
    status: missing.length === 0 && hasModelKey ? 'ok' : 'fail',
    detail: {
      missing,
      hasModelKey,
      database: hasValue('DATABASE_URL')
        ? redactDatabaseUrl(envValue('DATABASE_URL'))
        : null,
      directDatabase: hasValue('DIRECT_URL')
        ? redactDatabaseUrl(envValue('DIRECT_URL'))
        : null,
      databaseHints: databaseHints(),
      elasticsearchEnabled: booleanEnv('ELASTICSEARCH_ENABLED'),
      hybridKeywordBackend: envValue('HYBRID_KEYWORD_BACKEND') || 'pg',
      elasticsearchIndexVersion:
        envValue('ELASTICSEARCH_INDEX_VERSION') || 'default',
    },
  };
}

async function checkDatabase(skip: boolean): Promise<CheckResult> {
  if (skip) {
    return {
      name: 'database',
      status: 'skip',
      detail: {
        reason: '命令参数要求跳过数据库检查',
      },
    };
  }

  const databaseUrl = envValue('DATABASE_URL');
  if (!databaseUrl) {
    return {
      name: 'database',
      status: 'fail',
      detail: {
        reason: 'DATABASE_URL 为空',
      },
    };
  }

  const runtimeCheck = await checkDatabaseUrl('DATABASE_URL', databaseUrl);
  const directUrl = envValue('DIRECT_URL');
  const directCheck = directUrl
    ? await checkDatabaseUrl('DIRECT_URL', directUrl)
    : null;
  const derivedDirectUrl = readArg('check-derived-direct')
    ? buildDerivedDirectUrl()
    : null;
  const derivedDirectCheck = derivedDirectUrl
    ? await checkDatabaseUrl('DERIVED_DIRECT_URL', derivedDirectUrl)
    : null;
  const poolerCandidateChecks = readArg('check-pooler-candidates')
    ? await checkPoolerCandidates()
    : null;

  return {
    name: 'database',
    status: runtimeCheck.status,
    detail: {
      runtime: runtimeCheck.detail,
      direct: directCheck?.detail ?? null,
      derivedDirect: derivedDirectCheck?.detail ?? null,
      poolerCandidates: poolerCandidateChecks,
      hints: databaseHints(),
    },
  };
}

async function checkPoolerCandidates(): Promise<Record<string, unknown>[]> {
  const candidates = buildPoolerCandidates();
  const results: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    const databaseUrl = buildCandidateUrl(candidate);
    const redactedCandidate = redactPoolerCandidate(candidate);
    if (!databaseUrl) {
      results.push({
        ...redactedCandidate,
        status: 'fail',
        reason: '无法根据 DATABASE_URL 构造候选连接串',
      });
      continue;
    }

    const result = await checkDatabaseUrl('POOLER_CANDIDATE', databaseUrl);
    results.push({
      ...redactedCandidate,
      status: result.status,
      detail: result.detail,
    });
  }

  return results;
}

function buildPoolerCandidates(): PoolerCandidate[] {
  return buildPoolerCandidatesFromEnv({
    databaseUrl: envValue('DATABASE_URL'),
    supabaseUrl: envValue('SUPABASE_URL'),
  });
}

function buildCandidateUrl(candidate: PoolerCandidate): string | null {
  return buildPoolerCandidateUrl(envValue('DATABASE_URL'), candidate);
}

async function checkDatabaseUrl(
  name: string,
  databaseUrl: string,
): Promise<CheckResult> {
  const client = new PgClient({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    const result = await client.query('select 1 as ok');
    return {
      name,
      status: result.rows[0]?.ok === 1 ? 'ok' : 'fail',
      detail: {
        ...redactDatabaseUrl(databaseUrl),
      },
    };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: {
        ...failDetail(error),
        database: redactDatabaseUrl(databaseUrl),
      },
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkElasticsearch(skip: boolean): Promise<CheckResult> {
  if (skip || !booleanEnv('ELASTICSEARCH_ENABLED')) {
    return {
      name: 'elasticsearch',
      status: 'skip',
      detail: {
        reason: skip
          ? '命令参数要求跳过 ES 检查'
          : 'ELASTICSEARCH_ENABLED=false',
      },
    };
  }

  const node = envValue('ELASTICSEARCH_URL') || 'http://localhost:9200';
  const indexPrefix = envValue('ELASTICSEARCH_INDEX_PREFIX') || 'digital-human';
  const indexVersion = envValue('ELASTICSEARCH_INDEX_VERSION') || 'v2';
  const index = `${indexPrefix}-knowledge-chunk-${indexVersion}`;

  const client = new ElasticsearchClient({
    node,
    maxRetries: 0,
    requestTimeout: 5000,
  });

  try {
    const health = await client.cluster.health();
    const indexExists = await client.indices.exists({ index });
    const alias = await client.indices
      .getAlias({
        name: `${indexPrefix}-knowledge-chunk-read,${indexPrefix}-knowledge-chunk-write`,
        ignore_unavailable: true,
      })
      .catch(() => ({}));

    return {
      name: 'elasticsearch',
      status: 'ok',
      detail: {
        node,
        clusterStatus: health.status,
        index,
        indexExists,
        aliasIndexes: Object.keys(alias),
      },
    };
  } catch (error) {
    return {
      name: 'elasticsearch',
      status: 'fail',
      detail: failDetail(error),
    };
  }
}

async function checkSupabaseRest(skip: boolean): Promise<CheckResult> {
  if (skip) {
    return {
      name: 'supabaseRest',
      status: 'skip',
      detail: {
        reason: '未传入 --check-supabase-rest',
      },
    };
  }

  const supabaseUrl = envValue('SUPABASE_URL');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      name: 'supabaseRest',
      status: 'fail',
      detail: {
        reason: 'SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 为空',
        endpoint: supabaseUrl ? redactSupabaseRestEndpoint(supabaseUrl) : null,
      },
    };
  }

  const endpoint = buildSupabaseRestUrl(supabaseUrl);
  if (!endpoint) {
    return {
      name: 'supabaseRest',
      status: 'fail',
      detail: {
        reason: 'SUPABASE_URL 无法解析',
        endpoint: redactSupabaseRestEndpoint(supabaseUrl),
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);

    return {
      name: 'supabaseRest',
      status: response.ok ? 'ok' : 'fail',
      detail: {
        endpoint: redactSupabaseRestEndpoint(supabaseUrl),
        statusCode: response.status,
        statusText: response.statusText,
      },
    };
  } catch (error) {
    return {
      name: 'supabaseRest',
      status: 'fail',
      detail: {
        endpoint: redactSupabaseRestEndpoint(supabaseUrl),
        ...failDetail(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSupabaseRestUrl(supabaseUrl: string): string | null {
  try {
    const url = new URL(supabaseUrl);
    url.pathname = '/rest/v1/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const checks = await Promise.all([
    checkEnv(),
    checkDatabase(readArg('skip-db')),
    checkElasticsearch(readArg('skip-es')),
    checkSupabaseRest(!readArg('check-supabase-rest')),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    checks,
  };
  console.log(JSON.stringify(report, null, 2));

  if (checks.some((check) => check.status === 'fail')) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `RAG 预检失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
