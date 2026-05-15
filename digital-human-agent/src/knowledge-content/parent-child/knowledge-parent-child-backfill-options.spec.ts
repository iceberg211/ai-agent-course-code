import {
  buildKnowledgeParentChildBackfillConnectionWarnings,
  resolveKnowledgeParentChildBackfillOptions,
} from '@/knowledge-content/parent-child/knowledge-parent-child-backfill-options';

describe('resolveKnowledgeParentChildBackfillOptions', () => {
  it('使用默认 pageSize、parent chunk 参数和索引版本', () => {
    expect(resolveKnowledgeParentChildBackfillOptions([], {})).toEqual({
      dryRun: false,
      pageSize: 200,
      indexVersion: 'parent-child-v1',
      maxParentChars: 2000,
      maxChildChunks: 5,
    });
  });

  it('支持 dry-run、page-size、父块大小和环境变量版本', () => {
    expect(
      resolveKnowledgeParentChildBackfillOptions(
        ['--dry-run', '--page-size=50', '--max-parent-chars=1200', '--max-child-chunks=3'],
        {
          PARENT_CHILD_INDEX_VERSION: 'parent-child-v2',
        },
      ),
    ).toEqual({
      dryRun: true,
      pageSize: 50,
      indexVersion: 'parent-child-v2',
      maxParentChars: 1200,
      maxChildChunks: 3,
    });
  });

  it('拒绝非法数值参数', () => {
    expect(() =>
      resolveKnowledgeParentChildBackfillOptions(['--page-size=0'], {}),
    ).toThrow('非法的 page-size：--page-size=0');
    expect(() =>
      resolveKnowledgeParentChildBackfillOptions(['--max-parent-chars=100'], {}),
    ).toThrow('非法的 max-parent-chars：--max-parent-chars=100');
    expect(() =>
      resolveKnowledgeParentChildBackfillOptions(['--max-child-chunks=0'], {}),
    ).toThrow('非法的 max-child-chunks：--max-child-chunks=0');
  });

  it('Parent-Child 回填 dry-run 会提示 transaction pooler 风险', () => {
    expect(
      buildKnowledgeParentChildBackfillConnectionWarnings(
        'postgresql://postgres.project-ref:pw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      ),
    ).toEqual([
      'DATABASE_URL 当前是 Supabase Transaction pooler；Parent-Child 回填是长任务，如遇连接中断请改用 Session pooler 或 Direct connection。',
    ]);
  });
});
