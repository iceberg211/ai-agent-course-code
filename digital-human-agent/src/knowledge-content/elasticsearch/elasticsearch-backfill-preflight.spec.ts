import {
  assertElasticsearchBackfillDatabaseReady,
  type BackfillDatabaseConnector,
} from '@/knowledge-content/elasticsearch/elasticsearch-backfill-preflight';

describe('assertElasticsearchBackfillDatabaseReady', () => {
  it('DATABASE_URL 为空时直接拒绝回填', async () => {
    await expect(
      assertElasticsearchBackfillDatabaseReady('', async () => undefined),
    ).rejects.toThrow('DATABASE_URL 为空，无法执行 ES 回填');
  });

  it('数据库连接失败时输出脱敏 host 和错误码', async () => {
    const connector: BackfillDatabaseConnector = async () => {
      const error = new Error(
        'tenant/user postgres.secret-project not found',
      ) as Error & {
        code: string;
      };
      error.code = 'XX000';
      throw error;
    };

    await expect(
      assertElasticsearchBackfillDatabaseReady(
        'postgresql://postgres.secret:password@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres',
        connector,
      ),
    ).rejects.toThrow(
      'ES 回填预检失败 database host=aws-1-ap-southeast-1.pooler.supabase.com: tenant/user post...ject not found code=XX000。请先运行 pnpm rag:preflight 查看脱敏诊断。',
    );
  });

  it('数据库连接可用时继续执行', async () => {
    const calls: string[] = [];
    const connector: BackfillDatabaseConnector = async (databaseUrl) => {
      calls.push(databaseUrl);
    };

    await expect(
      assertElasticsearchBackfillDatabaseReady(
        'postgresql://postgres:password@example.supabase.co:5432/postgres',
        connector,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      'postgresql://postgres:password@example.supabase.co:5432/postgres',
    ]);
  });
});
