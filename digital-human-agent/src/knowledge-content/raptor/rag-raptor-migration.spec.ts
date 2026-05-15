import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('rag raptor index migration', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/013_rag_raptor_index.sql',
  );
  const rollbackPath = join(
    process.cwd(),
    'supabase/rollbacks/013_rag_raptor_index.rollback.sql',
  );

  it('定义 RAPTOR 摘要树状态、节点和父子边表', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_raptor_index_status');
    expect(sql).toContain("CHECK (status IN ('pending', 'indexed', 'failed', 'stale'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_raptor_node');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_raptor_edge');
    expect(sql).toContain('summarizer_version');
    expect(sql).toContain('schema_version');
    expect(sql).toContain('source_chunk_ids');
  });

  it('提供按依赖顺序删除 RAPTOR 派生索引的 rollback', () => {
    const sql = readFileSync(rollbackPath, 'utf8');

    expect(sql).toContain('DROP TABLE IF EXISTS rag_raptor_edge');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_raptor_node');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_raptor_index_status');
    expect(sql).not.toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+knowledge_chunk/i);
  });
});
