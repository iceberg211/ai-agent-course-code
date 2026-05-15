import {
  buildRagRaptorBackfillConnectionWarnings,
  resolveRagRaptorBackfillOptions,
} from '@/knowledge-content/raptor/rag-raptor-backfill-options';

describe('rag raptor backfill options', () => {
  it('解析 dry-run、分页、fanout、层数和版本参数', () => {
    expect(
      resolveRagRaptorBackfillOptions(
        [
          '--dry-run',
          '--page-size=50',
          '--fanout=4',
          '--max-layers=3',
        ],
        {
          RAG_RAPTOR_SUMMARIZER_VERSION: 'raptor-summary-v2',
          RAG_RAPTOR_SCHEMA_VERSION: 'raptor-schema-v2',
          RAG_RAPTOR_SUMMARIZER_MODEL: 'qwen-plus',
        },
      ),
    ).toEqual({
      dryRun: true,
      pageSize: 50,
      fanout: 4,
      maxLayers: 3,
      summarizerVersion: 'raptor-summary-v2',
      schemaVersion: 'raptor-schema-v2',
      summarizerModel: 'qwen-plus',
    });
  });

  it('非法参数会直接失败', () => {
    expect(() =>
      resolveRagRaptorBackfillOptions(['--fanout=1'], {}),
    ).toThrow('非法的 fanout');

    expect(() =>
      resolveRagRaptorBackfillOptions(['--max-layers=0'], {}),
    ).toThrow('非法的 max-layers');
  });

  it('对长任务数据库连接给出风险提示', () => {
    expect(
      buildRagRaptorBackfillConnectionWarnings(
        'postgresql://user:pass@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      ),
    ).toEqual([
      'DATABASE_URL 当前是 Supabase Transaction pooler；RAPTOR 回填需要读取 chunk、生成摘要并写入多层索引，如遇连接中断请改用 Session pooler 或 Direct connection。',
    ]);
  });
});
