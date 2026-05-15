export const DEFAULT_RAG_RAPTOR_SUMMARIZER_VERSION =
  'raptor-summarizer-v1';
export const DEFAULT_RAG_RAPTOR_SCHEMA_VERSION = 'raptor-schema-v1';
export const DEFAULT_RAG_RAPTOR_SUMMARIZER_MODEL = 'disabled';

export interface RagRaptorBackfillOptions {
  dryRun: boolean;
  pageSize: number;
  fanout: number;
  maxLayers: number;
  summarizerVersion: string;
  schemaVersion: string;
  summarizerModel: string;
}

export function resolveRagRaptorBackfillOptions(
  args: string[],
  env: Record<string, string | undefined>,
): RagRaptorBackfillOptions {
  return {
    dryRun: args.includes('--dry-run'),
    pageSize: resolvePositiveInteger(args, 'page-size', 200, 1, 1000),
    fanout: resolvePositiveInteger(args, 'fanout', 5, 2, 20),
    maxLayers: resolvePositiveInteger(args, 'max-layers', 3, 1, 6),
    summarizerVersion:
      env.RAG_RAPTOR_SUMMARIZER_VERSION?.trim() ||
      DEFAULT_RAG_RAPTOR_SUMMARIZER_VERSION,
    schemaVersion:
      env.RAG_RAPTOR_SCHEMA_VERSION?.trim() ||
      DEFAULT_RAG_RAPTOR_SCHEMA_VERSION,
    summarizerModel:
      env.RAG_RAPTOR_SUMMARIZER_MODEL?.trim() ||
      env.MODEL_NAME?.trim() ||
      DEFAULT_RAG_RAPTOR_SUMMARIZER_MODEL,
  };
}

export function buildRagRaptorBackfillConnectionWarnings(
  databaseUrl: string,
): string[] {
  const normalizedUrl = databaseUrl.trim();
  if (!normalizedUrl) {
    return ['DATABASE_URL 为空，真实 RAPTOR 回填会失败。'];
  }

  try {
    const url = new URL(normalizedUrl);
    if (
      url.hostname.endsWith('.pooler.supabase.com') &&
      (url.port === '6543' || url.searchParams.has('pgbouncer'))
    ) {
      return [
        'DATABASE_URL 当前是 Supabase Transaction pooler；RAPTOR 回填需要读取 chunk、生成摘要并写入多层索引，如遇连接中断请改用 Session pooler 或 Direct connection。',
      ];
    }
    return [];
  } catch {
    return ['DATABASE_URL 不是合法 URL，真实 RAPTOR 回填会失败。'];
  }
}

function resolvePositiveInteger(
  args: string[],
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const rawValue = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue.split('=')[1]);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`非法的 ${name}：${rawValue}`);
  }

  return Math.trunc(parsed);
}
