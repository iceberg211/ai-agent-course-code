import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('RAG graph index migration', () => {
  const migrationPath = join(
    __dirname,
    '../../../supabase/migrations/010_rag_graph_index.sql',
  );
  const rollbackPath = join(
    __dirname,
    '../../../supabase/rollbacks/010_rag_graph_index.rollback.sql',
  );

  it('定义图谱派生索引的状态、节点和关系表', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_graph_index_status');
    expect(sql).toContain("CHECK (status IN ('pending', 'indexed', 'failed', 'stale'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_graph_node');
    expect(sql).toContain("CHECK (node_type IN ('Entity', 'Event', 'Topic', 'Document', 'Chunk'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rag_graph_edge');
    expect(sql).toContain('UNIQUE');
    expect(sql).toContain('extractor_version');
    expect(sql).toContain('schema_version');
  });

  it('提供按依赖顺序删除图谱派生索引的 rollback', () => {
    const sql = readFileSync(rollbackPath, 'utf8');

    expect(sql).toContain('DROP TABLE IF EXISTS rag_graph_edge');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_graph_node');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_graph_index_status');
  });
});
