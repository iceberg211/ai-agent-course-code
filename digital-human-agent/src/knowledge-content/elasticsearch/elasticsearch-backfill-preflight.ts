import { Client as PgClient } from 'pg';
import { formatRagEvalError } from '@/knowledge-content/evaluation/rag-eval-report';
import { redactRuntimeDiagnostic } from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';

export type BackfillDatabaseConnector = (databaseUrl: string) => Promise<void>;

export async function assertElasticsearchBackfillDatabaseReady(
  databaseUrl: string,
  connector: BackfillDatabaseConnector = connectPostgresOnce,
): Promise<void> {
  const normalizedUrl = databaseUrl.trim();
  if (!normalizedUrl) {
    throw new Error('DATABASE_URL 为空，无法执行 ES 回填');
  }

  try {
    await connector(normalizedUrl);
  } catch (error) {
    const host = redactRuntimeDiagnostic(readDatabaseHost(normalizedUrl));
    const reason = redactRuntimeDiagnostic(formatRagEvalError(error));
    throw new Error(
      `ES 回填预检失败 database host=${host}: ${reason}。请先运行 pnpm rag:preflight 查看脱敏诊断。`,
    );
  }
}

async function connectPostgresOnce(databaseUrl: string): Promise<void> {
  const client = new PgClient({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    await client.query('select 1 as ok');
  } finally {
    await client.end().catch(() => undefined);
  }
}

function readDatabaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return 'unknown';
  }
}
