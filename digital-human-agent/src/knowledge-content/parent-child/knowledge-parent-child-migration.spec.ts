import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Parent-Child index migration', () => {
  const migrationPath = join(
    __dirname,
    '../../../supabase/migrations/012_rag_parent_child_index.sql',
  );
  const rollbackPath = join(
    __dirname,
    '../../../supabase/rollbacks/012_rag_parent_child_index.rollback.sql',
  );
  const migrateScriptPath = join(__dirname, '../../../scripts/migrate.js');

  it('定义 parent chunk 状态、父块和父子映射表', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_parent_chunk_index_status');
    expect(sql).toContain("CHECK (status IN ('pending', 'indexed', 'failed', 'stale'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_parent_chunk');
    expect(sql).toContain('parent_key');
    expect(sql).toContain('start_chunk_index');
    expect(sql).toContain('end_chunk_index');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_parent_chunk_child');
    expect(sql).toContain('chunk_id');
    expect(sql).toContain('index_version');
  });

  it('提供按依赖顺序删除 Parent-Child 派生索引的 rollback', () => {
    const sql = readFileSync(rollbackPath, 'utf8');

    expect(sql).toContain('DROP TABLE IF EXISTS rag_parent_chunk_child');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_parent_chunk');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_parent_chunk_index_status');
  });

  it('db:migrate dry-run 能看到 012 migration', () => {
    const script = readFileSync(migrateScriptPath, 'utf8');

    expect(script).toContain("'012_rag_parent_child_index.sql'");
  });
});
