import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('P2 Graph/RAPTOR script inventory', () => {
  const rootDir = join(__dirname, '../../..');

  it('package.json 暴露 Graph 与 RAPTOR 的可执行边界命令', () => {
    const packageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['graph:backfill']).toBe(
      'node -r ts-node/register -r tsconfig-paths/register ./scripts/backfill-knowledge-graph.ts',
    );
    expect(packageJson.scripts['raptor:backfill']).toBe(
      'node -r ts-node/register -r tsconfig-paths/register ./scripts/backfill-raptor-index.ts',
    );
  });

  it('Graph backfill 脚本支持 dry-run 和真实执行边界', () => {
    const scriptPath = join(rootDir, 'scripts/backfill-knowledge-graph.ts');
    expect(existsSync(scriptPath)).toBe(true);

    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain("action: 'graph-backfill'");
    expect(source).toContain('KnowledgeGraphBackfillService');
    expect(source).toContain('assertKnowledgeGraphBackfillDatabaseReady');
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
