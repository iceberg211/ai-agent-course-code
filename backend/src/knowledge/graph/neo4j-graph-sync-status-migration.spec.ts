import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Neo4j graph sync status migration', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/014_knowledge_document_graph_sync_status.sql',
  );
  const rollbackPath = join(
    process.cwd(),
    'supabase/rollbacks/014_knowledge_document_graph_sync_status.rollback.sql',
  );
  const migrateScriptPath = join(process.cwd(), 'scripts/migrate.js');

  it('给 knowledge_document 增加图谱同步状态字段', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('graph_sync_status');
    expect(sql).toContain(
      "CHECK (graph_sync_status IN ('pending', 'indexed', 'failed', 'skipped'))",
    );
    expect(sql).toContain('graph_sync_error');
    expect(sql).toContain('graph_synced_at');
  });

  it('提供 rollback 删除图谱同步状态字段', () => {
    const sql = readFileSync(rollbackPath, 'utf8');

    expect(sql).toContain('DROP COLUMN IF EXISTS graph_synced_at');
    expect(sql).toContain('DROP COLUMN IF EXISTS graph_sync_error');
    expect(sql).toContain('DROP COLUMN IF EXISTS graph_sync_status');
  });

  it('db:migrate dry-run 能看到 014 migration', () => {
    const script = readFileSync(migrateScriptPath, 'utf8');

    expect(script).toContain("'014_knowledge_document_graph_sync_status.sql'");
  });
});
