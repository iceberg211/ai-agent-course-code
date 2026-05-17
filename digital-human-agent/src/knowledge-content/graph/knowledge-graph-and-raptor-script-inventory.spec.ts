import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Neo4j Graph/RAPTOR script inventory', () => {
  const rootDir = join(__dirname, '../../..');

  it('package.json 只暴露 Neo4j Graph、ES 与 RAPTOR 的可执行边界命令', () => {
    const packageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['neo4j:up']).toBe(
      'docker compose -f docker-compose.rag.yml up -d neo4j',
    );
    expect(packageJson.scripts['neo4j:backfill']).toBe(
      'node -r ts-node/register -r tsconfig-paths/register ./scripts/backfill-knowledge-neo4j.ts',
    );
    expect(packageJson.scripts['rag:smoke:agentic']).toBe(
      'node -r ts-node/register -r tsconfig-paths/register ./scripts/smoke-rag-agentic.ts',
    );
    expect(packageJson.scripts['graph:backfill']).toBeUndefined();
    expect(packageJson.scripts['rag:smoke:graph']).toBeUndefined();
    expect(packageJson.scripts['rag:smoke:graph-flow']).toBeUndefined();
    expect(packageJson.scripts['rag:smoke:graph-answer']).toBeUndefined();
    expect(packageJson.scripts['raptor:backfill']).toBeUndefined();
    expect(packageJson.scripts['parent-child:backfill']).toBeUndefined();
    expect(packageJson.scripts['eval:rag']).toBeUndefined();
    expect(packageJson.scripts['es:alias:switch']).toBeUndefined();
    expect(packageJson.scripts['es:alias:rollback']).toBeUndefined();
  });

  it('Neo4j backfill 脚本使用 Neo4jGraphSyncService，不再写 PostgreSQL 图谱表', () => {
    const scriptPath = join(rootDir, 'scripts/backfill-knowledge-neo4j.ts');
    expect(existsSync(scriptPath)).toBe(true);

    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain("action: 'neo4j-backfill'");
    expect(source).toContain('Neo4jGraphBackfillService');
    expect(source).toContain('Neo4jGraphSyncService');
    expect(source).not.toContain('rag_graph_');
  });

  it('Agentic RAG smoke 脚本验证向量、关键词和 Neo4j 三路参与状态', () => {
    const scriptPath = join(rootDir, 'scripts/smoke-rag-agentic.ts');
    expect(existsSync(scriptPath)).toBe(true);

    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain('KnowledgeSearchService');
    expect(source).toContain('retrieveForPersonaWithStages');
    expect(source).toContain('NEO4J_GRAPH_ENABLED');
    expect(source).toContain('vectorResultCount');
    expect(source).toContain('keywordResultCount');
    expect(source).toContain('graphResultCount');
  });

  it('RAPTOR backfill 脚本只声明第一阶段 plan-only dry-run', () => {
    const scriptPath = join(rootDir, 'scripts/backfill-raptor-index.ts');
    expect(existsSync(scriptPath)).toBe(true);

    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain("action: 'raptor-backfill'");
    expect(source).toContain('liveBackfillEnabled: false');
    expect(source).toContain('第一阶段只支持 --dry-run');
  });
});
