import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('rag semantic cache schema', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/009_rag_semantic_cache.sql',
  );
  const rollbackPath = join(
    process.cwd(),
    'supabase/rollbacks/009_rag_semantic_cache.rollback.sql',
  );

  it('migration 有对应回退 SQL，且回退不删除共享 vector 扩展', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const rollback = readFileSync(rollbackPath, 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS rag_semantic_cache');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION match_rag_semantic_cache');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS match_rag_semantic_cache');
    expect(rollback).toContain('DROP TABLE IF EXISTS rag_semantic_cache');
    expect(rollback).not.toMatch(/DROP\s+EXTENSION/i);
  });
});
