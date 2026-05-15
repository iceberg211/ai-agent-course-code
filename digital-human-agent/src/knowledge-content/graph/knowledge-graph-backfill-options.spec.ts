import {
  buildKnowledgeGraphBackfillConnectionWarnings,
  resolveKnowledgeGraphBackfillOptions,
} from '@/knowledge-content/graph/knowledge-graph-backfill-options';

describe('resolveKnowledgeGraphBackfillOptions', () => {
  it('使用默认 pageSize 和默认图谱版本', () => {
    expect(resolveKnowledgeGraphBackfillOptions([], {})).toEqual({
      dryRun: false,
      pageSize: 200,
      extractorVersion: 'graph-extractor-v1',
      schemaVersion: 'graph-schema-v1',
    });
  });

  it('支持 dry-run、page-size 和环境变量版本', () => {
    expect(
      resolveKnowledgeGraphBackfillOptions(['--dry-run', '--page-size=50'], {
        RAG_GRAPH_EXTRACTOR_VERSION: 'graph-extractor-v2',
        GRAPH_INDEX_VERSION: 'graph-schema-v2',
      }),
    ).toEqual({
      dryRun: true,
      pageSize: 50,
      extractorVersion: 'graph-extractor-v2',
      schemaVersion: 'graph-schema-v2',
    });
  });

  it('拒绝非法 page-size', () => {
    expect(() =>
      resolveKnowledgeGraphBackfillOptions(['--page-size=0'], {}),
    ).toThrow('非法的 page-size：--page-size=0');
  });

  it('Graph 回填 dry-run 会提示 transaction pooler 风险', () => {
    expect(
      buildKnowledgeGraphBackfillConnectionWarnings(
        'postgresql://postgres.project-ref:pw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      ),
    ).toEqual([
      'DATABASE_URL 当前是 Supabase Transaction pooler；Graph RAG 回填是长任务，如遇连接中断请改用 Session pooler 或 Direct connection。',
    ]);
  });

  it('Session pooler 和 direct host 不产生 Graph 回填连接警告', () => {
    expect(
      buildKnowledgeGraphBackfillConnectionWarnings(
        'postgresql://postgres.project-ref:pw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
      ),
    ).toEqual([]);
    expect(
      buildKnowledgeGraphBackfillConnectionWarnings(
        'postgresql://postgres:pw@db.project-ref.supabase.co:5432/postgres',
      ),
    ).toEqual([]);
  });
});
