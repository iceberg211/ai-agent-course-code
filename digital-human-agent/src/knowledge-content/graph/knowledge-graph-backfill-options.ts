import {
  DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION,
  DEFAULT_RAG_GRAPH_SCHEMA_VERSION,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';

export interface KnowledgeGraphBackfillOptions {
  dryRun: boolean;
  pageSize: number;
  extractorVersion: string;
  schemaVersion: string;
}

export function resolveKnowledgeGraphBackfillOptions(
  args: string[],
  env: Record<string, string | undefined>,
): KnowledgeGraphBackfillOptions {
  return {
    dryRun: args.includes('--dry-run'),
    pageSize: resolvePageSize(args),
    extractorVersion:
      env.RAG_GRAPH_EXTRACTOR_VERSION?.trim() ||
      DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION,
    schemaVersion:
      env.GRAPH_INDEX_VERSION?.trim() || DEFAULT_RAG_GRAPH_SCHEMA_VERSION,
  };
}

export function buildKnowledgeGraphBackfillConnectionWarnings(
  databaseUrl: string,
): string[] {
  const normalizedUrl = databaseUrl.trim();
  if (!normalizedUrl) {
    return ['DATABASE_URL 为空，真实 Graph RAG 回填会失败。'];
  }

  try {
    const url = new URL(normalizedUrl);
    if (
      url.hostname.endsWith('.pooler.supabase.com') &&
      (url.port === '6543' || url.searchParams.has('pgbouncer'))
    ) {
      return [
        'DATABASE_URL 当前是 Supabase Transaction pooler；Graph RAG 回填是长任务，如遇连接中断请改用 Session pooler 或 Direct connection。',
      ];
    }
    return [];
  } catch {
    return ['DATABASE_URL 不是合法 URL，真实 Graph RAG 回填会失败。'];
  }
}

function resolvePageSize(args: string[]): number {
  const rawValue = args.find((arg) => arg.startsWith('--page-size='));
  if (!rawValue) {
    return 200;
  }

  const parsed = Number(rawValue.split('=')[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`非法的 page-size：${rawValue}`);
  }

  return Math.floor(parsed);
}
