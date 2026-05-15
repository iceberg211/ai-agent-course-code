import {
  assertKnowledgeGraphBackfillDatabaseReady,
  type GraphBackfillDatabaseConnector,
} from '@/knowledge-content/graph/knowledge-graph-backfill-preflight';

describe('assertKnowledgeGraphBackfillDatabaseReady', () => {
  it('DATABASE_URL 为空时直接拒绝 graph 回填', async () => {
    await expect(
      assertKnowledgeGraphBackfillDatabaseReady('', async () => undefined),
    ).rejects.toThrow('DATABASE_URL 为空，无法执行 Graph RAG 回填');
  });

  it('数据库连接失败时输出脱敏诊断', async () => {
    const connector: GraphBackfillDatabaseConnector = async () => {
      const error = new Error(
        'tenant/user postgres.secret-project not found',
      ) as Error & {
        code: string;
      };
      error.code = 'XX000';
      throw error;
    };

    await expect(
      assertKnowledgeGraphBackfillDatabaseReady(
        'postgresql://postgres.secret:password@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres',
        connector,
      ),
    ).rejects.toThrow(
      'Graph RAG 回填预检失败 database host=aws-1-ap-southeast-1.pooler.supabase.com: tenant/user post...ject not found code=XX000。请先运行 pnpm rag:preflight 查看脱敏诊断。',
    );
  });

  it('数据库连接可用时继续执行', async () => {
    const calls: string[] = [];
    const connector: GraphBackfillDatabaseConnector = async (databaseUrl) => {
      calls.push(databaseUrl);
    };

    await expect(
      assertKnowledgeGraphBackfillDatabaseReady(
        'postgresql://postgres:password@example.supabase.co:5432/postgres',
        connector,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      'postgresql://postgres:password@example.supabase.co:5432/postgres',
    ]);
  });
});
