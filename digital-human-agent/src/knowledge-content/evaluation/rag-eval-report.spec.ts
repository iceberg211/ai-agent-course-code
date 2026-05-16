import {
  buildRagEvalBlockedReportFileNames,
  buildRagEvalBlockerReport,
  buildRagEvalRuntimeMetadata,
  findRagEvalLiveEnvIssues,
  formatRagEvalError,
  parseRagEvalMode,
  requiresRagEvalModelCallApproval,
  shouldWriteRagEvalBlockerReport,
} from '@/knowledge-content/evaluation/rag-eval-report';

describe('buildRagEvalRuntimeMetadata', () => {
  it('live 模式会从环境值生成 backend、模型名和完整 index versions', () => {
    const metadata = buildRagEvalRuntimeMetadata({
      mode: 'live',
      env: {
        HYBRID_KEYWORD_BACKEND: 'elastic',
        ELASTICSEARCH_ENABLED: 'true',
        ELASTICSEARCH_INDEX_VERSION: 'v3',
        GRAPH_INDEX_VERSION: 'graph-v1',
        KNOWLEDGE_CHUNKING_VERSION: 'semantic-v1',
        MODEL_NAME: 'qwen-max',
        EMBEDDINGS_MODEL_NAME: 'text-embedding-v4',
        QUERY_REWRITE_MODEL_NAME: 'qwen-turbo',
        RERANKER_PROVIDER: 'dashscope',
        RERANKER_MODEL: 'qwen3-rerank',
      },
    });

    expect(metadata).toEqual({
      backend: {
        vector: 'pgvector',
        keyword: 'elastic',
        elasticsearchEnabled: 'true',
        mode: 'live',
      },
      models: {
        llm: 'qwen-max',
        embeddings: 'text-embedding-v4',
        queryRewrite: 'qwen-turbo',
        rerankerProvider: 'dashscope',
        rerankerModel: 'qwen3-rerank',
      },
      indexVersions: {
        elasticsearch: 'v3',
        graph: 'graph-v1',
        chunking: 'semantic-v1',
      },
    });
  });

  it('elastic-only 模式会标记禁用的向量和 rerank 通道，并保留目标索引', () => {
    const metadata = buildRagEvalRuntimeMetadata({
      mode: 'elastic-only',
      env: {
        ELASTICSEARCH_INDEX_VERSION: 'v2',
      },
      elasticIndexName: 'digital-human-knowledge-chunk-v2',
    });

    expect(metadata.backend).toMatchObject({
      vector: 'disabled',
      keyword: 'elastic',
      elasticsearchEnabled: 'true',
      mode: 'elastic-only',
      index: 'digital-human-knowledge-chunk-v2',
    });
    expect(metadata.models).toMatchObject({
      llm: null,
      embeddings: null,
      queryRewrite: null,
      rerankerProvider: 'disabled',
      rerankerModel: null,
    });
    expect(metadata.indexVersions).toMatchObject({
      elasticsearch: 'v2',
      graph: null,
      chunking: 'markdown-structure-v1',
    });
  });

  it('fixture-only 模式会标记离线 fixture 后端，不声明真实检索通道', () => {
    const metadata = buildRagEvalRuntimeMetadata({
      mode: 'fixture-only',
      env: {},
      fixtureDir: 'eval/fixtures',
    });

    expect(metadata.backend).toMatchObject({
      vector: 'disabled',
      keyword: 'fixture',
      elasticsearchEnabled: 'false',
      mode: 'fixture-only',
      fixtureDir: 'eval/fixtures',
    });
    expect(metadata.models).toMatchObject({
      llm: null,
      embeddings: null,
      queryRewrite: null,
      rerankerProvider: 'disabled',
      rerankerModel: null,
    });
  });

  it('live-keyword-only 模式会禁用模型、向量和 reranker 元数据', () => {
    const metadata = buildRagEvalRuntimeMetadata({
      mode: 'live-keyword-only',
      env: {
        HYBRID_KEYWORD_BACKEND: 'pg',
        ELASTICSEARCH_ENABLED: 'false',
        MODEL_NAME: 'qwen-max',
        EMBEDDINGS_MODEL_NAME: 'text-embedding-v4',
        RERANKER_PROVIDER: 'dashscope',
      },
    });

    expect(metadata.backend).toMatchObject({
      vector: 'disabled',
      keyword: 'pg',
      elasticsearchEnabled: 'false',
      mode: 'live-keyword-only',
    });
    expect(metadata.models).toEqual({
      llm: null,
      embeddings: null,
      queryRewrite: null,
      rerankerProvider: 'disabled',
      rerankerModel: null,
    });
  });

  it('格式化空 message 的 ES 连接错误，避免 eval 失败时只输出空白', () => {
    expect(
      formatRagEvalError({
        name: 'ConnectionError',
        message: '',
        meta: {
          statusCode: 0,
          connection: {
            url: 'http://localhost:9200/',
          },
        },
      }),
    ).toBe('ConnectionError statusCode=0 url=http://localhost:9200/');
  });

  it('构建 live eval blocker report 时只写入脱敏数据库形态和下一步命令', () => {
    expect(
      buildRagEvalBlockerReport({
        mode: 'live',
        generatedAt: '2026-05-15T00:00:00.000Z',
        reason:
          'database blocked: tenant/user postgres.project-ref not found with password pw-value',
        env: {
          DATABASE_URL:
            'postgresql://postgres.project-ref:pw-value@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
          HYBRID_KEYWORD_BACKEND: 'pg',
          RERANKER_PROVIDER: 'dashscope',
          RERANKER_MODEL: 'qwen3-rerank',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        generatedAt: '2026-05-15T00:00:00.000Z',
        status: 'blocked',
        mode: 'live',
        reason:
          'database blocked: tenant/user post...-ref not found with password ***',
        database: {
          protocol: 'postgresql:',
          host: 'aws-1-ap-southeast-1.pooler.supabase.com',
          port: '6543',
          database: 'postgres',
          username: 'post...-ref',
          hasPassword: true,
          hasSearchParams: true,
        },
        models: expect.objectContaining({
          rerankerProvider: 'dashscope',
          rerankerModel: 'qwen3-rerank',
        }),
        nextCommands: expect.arrayContaining([
          'pnpm rag:preflight -- --skip-es --check-derived-direct --check-pooler-candidates',
          'pnpm rag:preflight -- --skip-db --skip-es --check-supabase-rest',
          'pnpm db:migrate -- --dry-run',
          'pnpm eval:rag:live-keyword',
          'pnpm es:backfill',
          'pnpm es:alias:switch -- --from=v1 --to=v2 --dry-run',
          'pnpm eval:rag -- --allow-model-calls',
        ]),
      }),
    );
  });

  it('blocker reason 不保留完整数据库用户名或密码', () => {
    const report = buildRagEvalBlockerReport({
      mode: 'live-keyword-only',
      generatedAt: '2026-05-15T00:00:00.000Z',
      reason:
        'live eval preflight failed: tenant/user postgres.project-ref not found password=pw-demo',
      env: {
        DATABASE_URL:
          'postgresql://postgres.project-ref:pw-demo@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres',
      },
    });

    expect(report.reason).toContain('tenant/user post...-ref not found');
    expect(report.reason).toContain('password=***');
    expect(report.reason).not.toContain('postgres.project-ref');
    expect(report.reason).not.toContain('pw-demo');
  });

  it('blocker database 对 Supabase direct host 做脱敏', () => {
    const report = buildRagEvalBlockerReport({
      mode: 'live',
      generatedAt: '2026-05-15T00:00:00.000Z',
      reason: 'direct host unavailable',
      env: {
        DATABASE_URL:
          'postgresql://postgres:pw-value@db.project-ref.supabase.co:5432/postgres',
      },
    });

    expect(report.database).toEqual(
      expect.objectContaining({
        host: 'db.proj...-ref.supabase.co',
        username: '***',
      }),
    );
    expect(JSON.stringify(report)).not.toContain('db.project-ref.supabase.co');
  });

  it('为 blocker report 生成 latest 和 mode-specific 两个文件名，避免同日多模式互相覆盖', () => {
    expect(
      buildRagEvalBlockedReportFileNames('live-keyword-only', '20260515'),
    ).toEqual([
      'rag-eval-blocked-20260515.json',
      'rag-eval-blocked-live-keyword-only-20260515.json',
    ]);
  });

  it('live-keyword-only blocker report 会提示 DB 与 Supabase REST 预检命令', () => {
    const report = buildRagEvalBlockerReport({
      mode: 'live-keyword-only',
      generatedAt: '2026-05-15T00:00:00.000Z',
      reason: 'database unavailable',
      env: {
        DATABASE_URL:
          'postgresql://postgres.project-ref:pw-value@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      },
    });

    expect(report.nextCommands).toEqual([
      'pnpm rag:preflight -- --skip-es --check-derived-direct --check-pooler-candidates',
      'pnpm rag:preflight -- --skip-db --skip-es --check-supabase-rest',
      'pnpm eval:rag:live-keyword',
    ]);
  });

  it('validate-only 和 fixture-only 失败不会写 runtime blocker report', () => {
    expect(
      shouldWriteRagEvalBlockerReport({
        mode: 'live',
        validateOnly: true,
      }),
    ).toBe(false);
    expect(
      shouldWriteRagEvalBlockerReport({
        mode: 'fixture-only',
        validateOnly: false,
      }),
    ).toBe(false);
    expect(
      shouldWriteRagEvalBlockerReport({
        mode: 'live-keyword-only',
        validateOnly: false,
      }),
    ).toBe(true);
  });

  it('elastic-only blocker report 不附带数据库形态，避免误导为 DB 阻塞', () => {
    const report = buildRagEvalBlockerReport({
      mode: 'elastic-only',
      generatedAt: '2026-05-15T00:00:00.000Z',
      reason: 'elasticsearch unavailable',
      env: {
        DATABASE_URL:
          'postgresql://postgres.project-ref:pw-value@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      },
    });

    expect(report.database).toBeNull();
    expect(report.nextCommands).toEqual([
      'pnpm es:up',
      'pnpm es:index:ensure',
      'pnpm eval:rag -- --mode=elastic-only --indexVersion=v1',
    ]);
  });

  it('检查 live eval 必需环境变量和模型密钥', () => {
    expect(
      findRagEvalLiveEnvIssues({
        DATABASE_URL: 'postgres://user:pass@example/db',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role',
        MODEL_NAME: 'qwen-max',
        OPENAI_API_KEY: 'dashscope-key',
      }),
    ).toEqual([]);

    expect(findRagEvalLiveEnvIssues({ MODEL_NAME: 'qwen-max' })).toEqual([
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY',
    ]);
  });

  it('live-keyword-only 只要求真实数据库和 Supabase 环境，不要求模型密钥', () => {
    expect(
      findRagEvalLiveEnvIssues(
        {
          DATABASE_URL: 'postgres://user:pass@example/db',
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role',
        },
        'live-keyword-only',
      ),
    ).toEqual([]);
  });

  it('只有完整 live eval 需要显式模型调用授权', () => {
    expect(requiresRagEvalModelCallApproval('live')).toBe(true);
    expect(requiresRagEvalModelCallApproval('live-keyword-only')).toBe(false);
    expect(requiresRagEvalModelCallApproval('elastic-only')).toBe(false);
    expect(requiresRagEvalModelCallApproval('fixture-only')).toBe(false);
  });

  it('拒绝未知 eval mode，避免误进入 live 路径', () => {
    expect(parseRagEvalMode(undefined)).toBe('live');
    expect(parseRagEvalMode('fixture-only')).toBe('fixture-only');
    expect(() => parseRagEvalMode('fixture')).toThrow(
      '不支持的 eval mode：fixture',
    );
  });
});
