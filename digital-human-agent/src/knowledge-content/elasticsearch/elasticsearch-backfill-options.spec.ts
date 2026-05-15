import {
  buildElasticsearchBackfillConnectionWarnings,
  resolveElasticsearchBackfillOptions,
} from '@/knowledge-content/elasticsearch/elasticsearch-backfill-options';

describe('resolveElasticsearchBackfillOptions', () => {
  it('使用默认 pageSize', () => {
    expect(resolveElasticsearchBackfillOptions([])).toEqual({
      dryRun: false,
      pageSize: 200,
    });
  });

  it('支持 dry-run 和 page-size', () => {
    expect(
      resolveElasticsearchBackfillOptions(['--dry-run', '--page-size=50']),
    ).toEqual({
      dryRun: true,
      pageSize: 50,
    });
  });

  it('拒绝非法 page-size', () => {
    expect(() =>
      resolveElasticsearchBackfillOptions(['--page-size=0']),
    ).toThrow('非法的 page-size：--page-size=0');
  });

  it('ES 回填 dry-run 会提示 transaction pooler 风险', () => {
    expect(
      buildElasticsearchBackfillConnectionWarnings(
        'postgresql://postgres.project-ref:pw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      ),
    ).toEqual([
      'DATABASE_URL 当前是 Supabase Transaction pooler；ES 回填是分页长任务，如遇连接中断请改用 Session pooler 或 Direct connection。',
    ]);
  });

  it('Session pooler 和 direct host 不产生 ES 回填连接警告', () => {
    expect(
      buildElasticsearchBackfillConnectionWarnings(
        'postgresql://postgres.project-ref:pw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
      ),
    ).toEqual([]);
    expect(
      buildElasticsearchBackfillConnectionWarnings(
        'postgresql://postgres:pw@db.project-ref.supabase.co:5432/postgres',
      ),
    ).toEqual([]);
  });
});
