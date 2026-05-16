import {
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  DEFAULT_HYBRID_KEYWORD_BACKEND,
} from '@/common/constants';

export type RagEvalMode =
  | 'live'
  | 'live-keyword-only'
  | 'elastic-only'
  | 'fixture-only';

export const RAG_EVAL_MODES: readonly RagEvalMode[] = [
  'live',
  'live-keyword-only',
  'elastic-only',
  'fixture-only',
];

export function parseRagEvalMode(value: string | undefined): RagEvalMode {
  const mode = (value || 'live').trim();
  if (RAG_EVAL_MODES.includes(mode as RagEvalMode)) {
    return mode as RagEvalMode;
  }

  throw new Error(`不支持的 eval mode：${mode}，可选值：${RAG_EVAL_MODES.join(', ')}`);
}

export interface RagEvalRuntimeMetadataInput {
  mode: RagEvalMode;
  env: Record<string, string | undefined>;
  elasticIndexName?: string;
  fixtureDir?: string;
}

export interface RagEvalRuntimeMetadata {
  backend: Record<string, unknown>;
  models: Record<string, unknown>;
  indexVersions: {
    elasticsearch: string;
    graph: string | null;
    chunking: string;
  };
}

export interface RagEvalBlockerReport {
  generatedAt: string;
  status: 'blocked';
  mode: RagEvalMode;
  reason: string;
  database: Record<string, unknown> | null;
  backend: Record<string, unknown>;
  models: Record<string, unknown>;
  indexVersions: RagEvalRuntimeMetadata['indexVersions'];
  nextCommands: string[];
}

const DEFAULT_CHUNKING_VERSION = 'markdown-structure-v1';

export function buildRagEvalRuntimeMetadata(
  input: RagEvalRuntimeMetadataInput,
): RagEvalRuntimeMetadata {
  if (input.mode === 'elastic-only') {
    return {
      backend: {
        vector: 'disabled',
        keyword: 'elastic',
        elasticsearchEnabled: 'true',
        mode: 'elastic-only',
        index: input.elasticIndexName,
      },
      models: {
        llm: null,
        embeddings: null,
        queryRewrite: null,
        rerankerProvider: 'disabled',
        rerankerModel: null,
      },
      indexVersions: buildIndexVersions(input.env),
    };
  }

  if (input.mode === 'fixture-only') {
    return {
      backend: {
        vector: 'disabled',
        keyword: 'fixture',
        elasticsearchEnabled: 'false',
        mode: 'fixture-only',
        fixtureDir: input.fixtureDir,
      },
      models: {
        llm: null,
        embeddings: null,
        queryRewrite: null,
        rerankerProvider: 'disabled',
        rerankerModel: null,
      },
      indexVersions: buildIndexVersions(input.env),
    };
  }

  return {
    backend: {
      vector: input.mode === 'live-keyword-only' ? 'disabled' : 'pgvector',
      keyword: envValue(input.env, 'HYBRID_KEYWORD_BACKEND') || DEFAULT_HYBRID_KEYWORD_BACKEND,
      elasticsearchEnabled: envValue(input.env, 'ELASTICSEARCH_ENABLED') || 'false',
      mode: input.mode,
    },
    models: {
      llm:
        input.mode === 'live-keyword-only'
          ? null
          : envValue(input.env, 'MODEL_NAME') || null,
      embeddings:
        input.mode === 'live-keyword-only'
          ? null
          : envValue(input.env, 'EMBEDDINGS_MODEL_NAME') || 'text-embedding-v3',
      queryRewrite:
        input.mode === 'live-keyword-only'
          ? null
          : envValue(input.env, 'QUERY_REWRITE_MODEL_NAME') ||
            envValue(input.env, 'MODEL_NAME') ||
            null,
      rerankerProvider:
        input.mode === 'live-keyword-only'
          ? 'disabled'
          : envValue(input.env, 'RERANKER_PROVIDER') || 'llm-json',
      rerankerModel:
        input.mode === 'live-keyword-only'
          ? null
          : envValue(input.env, 'RERANKER_MODEL') ||
            envValue(input.env, 'RERANKER_MODEL_NAME') ||
            envValue(input.env, 'MODEL_NAME') ||
            null,
    },
    indexVersions: buildIndexVersions(input.env),
  };
}

export function formatRagEvalError(error: unknown): string {
  if (!isRecord(error)) {
    return String(error);
  }

  const name = readString(error.name);
  const message = readString(error.message);
  const parts: string[] = [];

  if (message) parts.push(message);
  if (name && !(name === 'Error' && message)) parts.push(name);

  const code = readString(error.code);
  if (code) parts.push(`code=${code}`);

  const statusCode =
    readNumber(error.statusCode) ??
    (isRecord(error.meta) ? readNumber(error.meta.statusCode) : null);
  if (statusCode !== null) parts.push(`statusCode=${statusCode}`);

  const url =
    isRecord(error.meta) &&
    isRecord(error.meta.connection) &&
    readString(error.meta.connection.url);
  if (url) parts.push(`url=${url}`);

  if (isRecord(error.cause)) {
    const causeMessage = readString(error.cause.message);
    const causeName = readString(error.cause.name);
    if (causeMessage || causeName) {
      parts.push(`cause=${causeMessage || causeName}`);
    }
  }

  return parts.length > 0 ? parts.join(' ') : String(error);
}

export function buildRagEvalBlockerReport(input: {
  mode: RagEvalMode;
  env: Record<string, string | undefined>;
  reason: string;
  generatedAt?: string;
}): RagEvalBlockerReport {
  const metadata = buildRagEvalRuntimeMetadata({
    mode: input.mode,
    env: input.env,
  });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: 'blocked',
    mode: input.mode,
    reason: redactRagEvalBlockerReason(input.reason, input.env),
    database: isDatabaseBackedEvalMode(input.mode)
      ? redactDatabaseUrl(envValue(input.env, 'DATABASE_URL'))
      : null,
    ...metadata,
    nextCommands: buildRagEvalBlockerNextCommands(input.mode),
  };
}

export function buildRagEvalBlockedReportFileNames(
  mode: RagEvalMode,
  dateStamp: string,
): string[] {
  return [
    `rag-eval-blocked-${dateStamp}.json`,
    `rag-eval-blocked-${mode}-${dateStamp}.json`,
  ];
}

export function shouldWriteRagEvalBlockerReport(input: {
  mode: RagEvalMode | null;
  validateOnly: boolean;
}): boolean {
  if (!input.mode || input.validateOnly) return false;
  return input.mode !== 'fixture-only';
}

export function findRagEvalLiveEnvIssues(
  env: Record<string, string | undefined>,
  mode: RagEvalMode = 'live',
): string[] {
  const missing = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((key) => !envValue(env, key));

  if (mode === 'live-keyword-only') {
    return missing;
  }

  if (!envValue(env, 'OPENAI_API_KEY')) {
    missing.push('OPENAI_API_KEY');
  }

  return missing;
}

export function requiresRagEvalModelCallApproval(mode: RagEvalMode): boolean {
  return mode === 'live';
}

function buildIndexVersions(
  env: Record<string, string | undefined>,
): RagEvalRuntimeMetadata['indexVersions'] {
  return {
    elasticsearch:
      envValue(env, 'ELASTICSEARCH_INDEX_VERSION') ||
      DEFAULT_ELASTICSEARCH_INDEX_VERSION,
    graph: envValue(env, 'GRAPH_INDEX_VERSION') || null,
    chunking:
      envValue(env, 'KNOWLEDGE_CHUNKING_VERSION') || DEFAULT_CHUNKING_VERSION,
  };
}

function isDatabaseBackedEvalMode(mode: RagEvalMode): boolean {
  return mode === 'live' || mode === 'live-keyword-only';
}

function buildRagEvalBlockerNextCommands(mode: RagEvalMode): string[] {
  if (mode === 'elastic-only') {
    return [
      'pnpm es:up',
      'pnpm es:index:ensure',
      'pnpm eval:rag -- --mode=elastic-only --indexVersion=v1',
    ];
  }

  if (mode === 'live-keyword-only') {
    return [
      'pnpm rag:preflight -- --skip-es --check-derived-direct --check-pooler-candidates',
      'pnpm rag:preflight -- --skip-db --skip-es --check-supabase-rest',
      'pnpm eval:rag:live-keyword',
    ];
  }

  return [
    'pnpm rag:preflight -- --skip-es --check-derived-direct --check-pooler-candidates',
    'pnpm rag:preflight -- --skip-db --skip-es --check-supabase-rest',
    'pnpm db:migrate -- --dry-run',
    'pnpm eval:rag:live-keyword',
    'pnpm es:backfill',
    'pnpm es:alias:switch -- --from=v1 --to=v2 --dry-run',
    'pnpm eval:rag -- --allow-model-calls',
  ];
}

function envValue(env: Record<string, string | undefined>, key: string): string {
  return String(env[key] ?? '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function redactDatabaseUrl(rawUrl: string): Record<string, unknown> | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    return {
      protocol: url.protocol,
      host: redactSupabaseHostname(url.hostname),
      port: url.port || null,
      database: url.pathname.replace(/^\//, '') || null,
      username: maskIdentifier(url.username),
      hasPassword: Boolean(url.password),
      hasSearchParams: url.search.length > 0,
    };
  } catch {
    return {
      parseError: true,
    };
  }
}

export function redactRagEvalBlockerReason(
  reason: string,
  env: Record<string, string | undefined>,
): string {
  return ['DATABASE_URL', 'DIRECT_URL'].reduce((current, key) => {
    return redactReasonWithDatabaseUrl(current, envValue(env, key));
  }, reason);
}

function redactReasonWithDatabaseUrl(reason: string, rawUrl: string): string {
  if (!rawUrl) return reason;

  try {
    const url = new URL(rawUrl);
    let redacted = reason;
    const username = safeDecodeURIComponent(url.username);
    const password = safeDecodeURIComponent(url.password);
    const maskedUsername = maskIdentifier(username) ?? '***';

    redacted = replaceLiteral(redacted, rawUrl, buildSafeDatabaseUrl(url));
    redacted = replaceLiteral(redacted, url.username, maskedUsername);
    redacted = replaceLiteral(redacted, username, maskedUsername);
    redacted = replaceLiteral(redacted, url.password, '***');
    redacted = replaceLiteral(redacted, password, '***');

    return redacted;
  } catch {
    return reason;
  }
}

function buildSafeDatabaseUrl(url: URL): string {
  const safeUrl = new URL(url.toString());
  const username = safeDecodeURIComponent(safeUrl.username);
  safeUrl.username = maskIdentifier(username) ?? '';
  if (safeUrl.password) safeUrl.password = '***';
  return safeUrl.toString();
}

function safeDecodeURIComponent(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function replaceLiteral(value: string, search: string, replacement: string): string {
  if (!search) return value;
  return value.split(search).join(replacement);
}

function maskIdentifier(value: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactSupabaseHostname(hostname: string): string {
  const directMatch = hostname.match(/^db\.([A-Za-z0-9_-]+)\.supabase\.co$/);
  if (directMatch) {
    return `db.${maskIdentifier(directMatch[1]) ?? '***'}.supabase.co`;
  }

  const projectMatch = hostname.match(/^([A-Za-z0-9_-]+)\.supabase\.co$/);
  if (projectMatch) {
    return `${maskIdentifier(projectMatch[1]) ?? '***'}.supabase.co`;
  }

  return hostname;
}
