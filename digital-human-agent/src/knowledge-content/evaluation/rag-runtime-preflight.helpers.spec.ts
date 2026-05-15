import {
  buildDatabaseHints,
  buildDerivedDirectUrl,
  buildPoolerCandidateUrl,
  buildPoolerCandidates,
  redactDatabaseUrl,
  redactPoolerCandidate,
  redactRuntimeDiagnostic,
  redactSupabaseRestEndpoint,
} from '@/knowledge-content/evaluation/rag-runtime-preflight.helpers';

describe('rag-runtime-preflight helpers', () => {
  const databaseUrl =
    'postgresql://postgres.project-ref:pw-value@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
  const supabaseUrl = 'https://project-ref.supabase.co';

  it('redactDatabaseUrl 只返回脱敏连接形态', () => {
    expect(redactDatabaseUrl(databaseUrl)).toEqual({
      protocol: 'postgresql:',
      host: 'aws-1-ap-southeast-1.pooler.supabase.com',
      port: '6543',
      database: 'postgres',
      username: 'post...-ref',
      hasPassword: true,
      hasSearchParams: true,
      kind: 'supabase-pooler-transaction',
    });
  });

  it('buildDatabaseHints 会标记 DIRECT_URL 仍指向 pooler', () => {
    expect(
      buildDatabaseHints({
        supabaseUrl,
        directUrl:
          'postgresql://postgres.project-ref:pw-value@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
      }),
    ).toEqual(
      expect.objectContaining({
        projectRef: 'proj...-ref',
        expectedDirectHost: 'db.proj...-ref.supabase.co',
        directUrlPresent: true,
        directUrlLooksLikePooler: true,
        supabaseRestCheck:
          '可用 --check-supabase-rest 验证 SUPABASE_URL 与 service role REST 连通性；该检查不输出表数据。',
      }),
    );
  });

  it('redactSupabaseRestEndpoint 只输出脱敏 REST 端点形态', () => {
    expect(redactSupabaseRestEndpoint(supabaseUrl)).toEqual({
      protocol: 'https:',
      host: 'proj...-ref.supabase.co',
      path: '/rest/v1/',
    });
  });

  it('buildDerivedDirectUrl 基于 SUPABASE_URL 生成 direct host 且保留密码', () => {
    const derived = buildDerivedDirectUrl({
      databaseUrl,
      supabaseUrl,
    });

    expect(redactDatabaseUrl(derived ?? '')).toEqual(
      expect.objectContaining({
        host: 'db.proj...-ref.supabase.co',
        port: '5432',
        username: '***',
        hasPassword: true,
        kind: 'supabase-direct',
      }),
    );
  });

  it('buildPoolerCandidates 会生成同区域 5432/6543 候选并去重', () => {
    expect(
      buildPoolerCandidates({
        databaseUrl,
        supabaseUrl,
      }),
    ).toEqual([
      {
        host: 'aws-0-ap-southeast-1.pooler.supabase.com',
        port: '5432',
        username: 'postgres.project-ref',
      },
      {
        host: 'aws-0-ap-southeast-1.pooler.supabase.com',
        port: '6543',
        username: 'postgres.project-ref',
      },
      {
        host: 'aws-1-ap-southeast-1.pooler.supabase.com',
        port: '5432',
        username: 'postgres.project-ref',
      },
      {
        host: 'aws-1-ap-southeast-1.pooler.supabase.com',
        port: '6543',
        username: 'postgres.project-ref',
      },
    ]);
  });

  it('buildPoolerCandidateUrl 保留原始连接串参数但替换候选 host/port/user', () => {
    const candidateUrl = buildPoolerCandidateUrl(databaseUrl, {
      host: 'aws-0-ap-southeast-1.pooler.supabase.com',
      port: '5432',
      username: 'postgres.project-ref',
    });

    expect(redactDatabaseUrl(candidateUrl ?? '')).toEqual(
      expect.objectContaining({
        host: 'aws-0-ap-southeast-1.pooler.supabase.com',
        port: '5432',
        username: 'post...-ref',
        hasPassword: true,
        hasSearchParams: true,
      }),
    );
  });

  it('redactPoolerCandidate 输出候选连接时会脱敏 username', () => {
    expect(
      redactPoolerCandidate({
        host: 'aws-0-ap-southeast-1.pooler.supabase.com',
        port: '5432',
        username: 'postgres.project-ref',
      }),
    ).toEqual({
      host: 'aws-0-ap-southeast-1.pooler.supabase.com',
      port: '5432',
      username: 'post...-ref',
    });
  });

  it('redactRuntimeDiagnostic 会脱敏错误消息中的项目 ref 和账号', () => {
    expect(
      redactRuntimeDiagnostic(
        '(ENOTFOUND) tenant/user postgres.project-ref not found on db.project-ref.supabase.co',
      ),
    ).toBe(
      '(ENOTFOUND) tenant/user post...-ref not found on db.proj...-ref.supabase.co',
    );
  });
});
