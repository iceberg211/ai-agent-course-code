import {
  DEFAULT_PARENT_CHILD_INDEX_VERSION,
  DEFAULT_PARENT_CHILD_MAX_CHARS,
  DEFAULT_PARENT_CHILD_MAX_CHILD_CHUNKS,
} from '@/knowledge-content/parent-child/knowledge-parent-child-plan';

export interface KnowledgeParentChildBackfillOptions {
  dryRun: boolean;
  pageSize: number;
  indexVersion: string;
  maxParentChars: number;
  maxChildChunks: number;
}

export function resolveKnowledgeParentChildBackfillOptions(
  args: string[],
  env: Record<string, string | undefined>,
): KnowledgeParentChildBackfillOptions {
  return {
    dryRun: args.includes('--dry-run'),
    pageSize: resolveInteger(args, 'page-size', 200, 1, 1000),
    indexVersion:
      env.PARENT_CHILD_INDEX_VERSION?.trim() ||
      DEFAULT_PARENT_CHILD_INDEX_VERSION,
    maxParentChars: resolveInteger(
      args,
      'max-parent-chars',
      DEFAULT_PARENT_CHILD_MAX_CHARS,
      500,
      12000,
    ),
    maxChildChunks: resolveInteger(
      args,
      'max-child-chunks',
      DEFAULT_PARENT_CHILD_MAX_CHILD_CHUNKS,
      1,
      20,
    ),
  };
}

export function buildKnowledgeParentChildBackfillConnectionWarnings(
  databaseUrl: string,
): string[] {
  const normalizedUrl = databaseUrl.trim();
  if (!normalizedUrl) {
    return ['DATABASE_URL 为空，真实 Parent-Child 回填会失败。'];
  }

  try {
    const url = new URL(normalizedUrl);
    if (
      url.hostname.endsWith('.pooler.supabase.com') &&
      (url.port === '6543' || url.searchParams.has('pgbouncer'))
    ) {
      return [
        'DATABASE_URL 当前是 Supabase Transaction pooler；Parent-Child 回填是长任务，如遇连接中断请改用 Session pooler 或 Direct connection。',
      ];
    }
    return [];
  } catch {
    return ['DATABASE_URL 不是合法 URL，真实 Parent-Child 回填会失败。'];
  }
}

function resolveInteger(
  args: string[],
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const rawValue = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!rawValue) return defaultValue;

  const parsed = Number(rawValue.split('=')[1]);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`非法的 ${name}：${rawValue}`);
  }
  return Math.trunc(parsed);
}
