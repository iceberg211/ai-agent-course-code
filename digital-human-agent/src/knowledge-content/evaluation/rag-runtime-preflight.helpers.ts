export interface PoolerCandidate {
  host: string;
  port: string;
  username: string;
}

export function redactDatabaseUrl(rawUrl: string): Record<string, unknown> {
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
      kind: classifyDatabaseUrl(url),
    };
  } catch {
    return {
      parseError: true,
    };
  }
}

export function classifyDatabaseUrl(url: URL): string {
  if (url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co')) {
    return 'supabase-direct';
  }
  if (url.hostname.endsWith('.pooler.supabase.com')) {
    return url.port === '6543'
      ? 'supabase-pooler-transaction'
      : 'supabase-pooler-session';
  }
  return 'custom-postgres';
}

export function readProjectRefFromSupabaseUrl(
  supabaseUrl: string,
): string | null {
  if (!supabaseUrl) return null;

  try {
    const url = new URL(supabaseUrl);
    const suffix = '.supabase.co';
    return url.hostname.endsWith(suffix)
      ? url.hostname.slice(0, -suffix.length)
      : null;
  } catch {
    return null;
  }
}

export function buildDatabaseHints(input: {
  supabaseUrl: string;
  directUrl?: string;
}): Record<string, unknown> {
  const projectRef = readProjectRefFromSupabaseUrl(input.supabaseUrl);
  const directLooksLikePooler = input.directUrl
    ? (() => {
        try {
          return new URL(input.directUrl).hostname.endsWith(
            '.pooler.supabase.com',
          );
        } catch {
          return false;
        }
      })()
    : false;

  return {
    projectRef: projectRef ? maskIdentifier(projectRef) : null,
    expectedDirectHost: projectRef
      ? `db.${maskIdentifier(projectRef)}.supabase.co`
      : null,
    directUrlPresent: Boolean(input.directUrl),
    directUrlLooksLikePooler: directLooksLikePooler,
    derivedDirectCheck:
      '可用 --check-derived-direct 临时测试 db.<project-ref>.supabase.co:5432；该检查只在内存中复用 DATABASE_URL 的密码，不输出密码。',
    poolerCandidateCheck:
      '可用 --check-pooler-candidates 临时测试同区域 pooler 5432/6543 候选；该检查只输出脱敏 host、port、username 和错误码。',
    supabaseRestCheck:
      '可用 --check-supabase-rest 验证 SUPABASE_URL 与 service role REST 连通性；该检查不输出表数据。',
    note:
      '应用运行时使用 DATABASE_URL；DIRECT_URL 只用于直连排障或 migration。连接串请以 Supabase Dashboard Connect 面板为准。',
  };
}

export function redactSupabaseRestEndpoint(
  supabaseUrl: string,
): Record<string, unknown> {
  try {
    const url = new URL(supabaseUrl);
    return {
      protocol: url.protocol,
      host: redactSupabaseHostname(url.hostname),
      path: '/rest/v1/',
    };
  } catch {
    return {
      parseError: true,
    };
  }
}

export function buildDerivedDirectUrl(input: {
  databaseUrl: string;
  supabaseUrl: string;
}): string | null {
  const projectRef = readProjectRefFromSupabaseUrl(input.supabaseUrl);
  if (!projectRef || !input.databaseUrl) return null;

  try {
    const runtimeUrl = new URL(input.databaseUrl);
    const directUrl = new URL(
      `postgresql://postgres@db.${projectRef}.supabase.co:5432/postgres`,
    );
    directUrl.password = runtimeUrl.password;
    return directUrl.toString();
  } catch {
    return null;
  }
}

export function buildPoolerCandidates(input: {
  databaseUrl: string;
  supabaseUrl: string;
}): PoolerCandidate[] {
  const projectRef = readProjectRefFromSupabaseUrl(input.supabaseUrl);
  if (!input.databaseUrl || !projectRef) return [];

  try {
    const url = new URL(input.databaseUrl);
    const regionMatch = url.hostname.match(
      /^aws-\d+-(.+)\.pooler\.supabase\.com$/,
    );
    const region = regionMatch?.[1];
    const hosts = region
      ? [
          `aws-0-${region}.pooler.supabase.com`,
          `aws-1-${region}.pooler.supabase.com`,
          url.hostname,
        ]
      : [url.hostname];
    const username = `postgres.${projectRef}`;
    const seen = new Set<string>();

    return hosts.flatMap((host) =>
      ['5432', '6543'].flatMap((port) => {
        const key = `${host}:${port}:${username}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            host,
            port,
            username,
          },
        ];
      }),
    );
  } catch {
    return [];
  }
}

export function redactPoolerCandidate(
  candidate: PoolerCandidate,
): PoolerCandidate {
  return {
    ...candidate,
    username: maskIdentifier(candidate.username),
  };
}

export function redactRuntimeDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return message
    .replace(
      /postgresql:\/\/([^:/@]+)(?::([^@]*))?@/gi,
      (_match, username: string) =>
        `postgresql://${maskIdentifier(decodeURIComponent(username))}:***@`,
    )
    .replace(/postgres\.[A-Za-z0-9_-]+/g, (username) =>
      maskIdentifier(username),
    )
    .replace(
      /\bdb\.([A-Za-z0-9_-]+)\.supabase\.co\b/g,
      (_match, projectRef: string) =>
        `db.${maskIdentifier(projectRef)}.supabase.co`,
    )
    .replace(
      /(^|[^.\w-])([A-Za-z0-9_-]+)\.supabase\.co\b/g,
      (_match, prefix: string, projectRef: string) =>
        `${prefix}${maskIdentifier(projectRef)}.supabase.co`,
    );
}

export function buildPoolerCandidateUrl(
  databaseUrl: string,
  candidate: PoolerCandidate,
): string | null {
  if (!databaseUrl) return null;

  try {
    const url = new URL(databaseUrl);
    url.hostname = candidate.host;
    url.port = candidate.port;
    url.username = candidate.username;
    url.pathname = url.pathname || '/postgres';
    return url.toString();
  } catch {
    return null;
  }
}

function maskIdentifier(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactSupabaseHostname(hostname: string): string {
  const directMatch = hostname.match(/^db\.([A-Za-z0-9_-]+)\.supabase\.co$/);
  if (directMatch) {
    return `db.${maskIdentifier(directMatch[1])}.supabase.co`;
  }

  const projectMatch = hostname.match(/^([A-Za-z0-9_-]+)\.supabase\.co$/);
  if (projectMatch) {
    return `${maskIdentifier(projectMatch[1])}.supabase.co`;
  }

  return hostname;
}
