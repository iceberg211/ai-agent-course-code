import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TaskStatus } from '@/common/enums';
import { Task } from '@/task/entities/task.entity';
import { WorkspaceCleanupService } from '@/workspace/workspace-cleanup.service';
import { WorkspaceService } from '@/workspace/workspace.service';

function createConfig(values: Record<string, string | number | undefined>) {
  return {
    get: jest.fn(<T>(key: string, defaultValue?: T) => {
      const value = values[key];
      return (value === undefined ? defaultValue : value) as T;
    }),
  } as unknown as ConfigService;
}

describe('WorkspaceCleanupService', () => {
  it('清理数据库已不存在或已超期终态任务的 workspace', async () => {
    const missingTaskId = '00000000-0000-4000-8000-000000000001';
    const staleTaskId = '00000000-0000-4000-8000-000000000002';
    const activeTaskId = '00000000-0000-4000-8000-000000000003';
    const taskRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: staleTaskId,
          status: TaskStatus.COMPLETED,
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          id: activeTaskId,
          status: TaskStatus.RUNNING,
          updatedAt: new Date('2026-04-12T00:00:00.000Z'),
        },
      ]),
    } as unknown as Repository<Task>;
    const workspace = {
      listTaskWorkspaceDirs: jest
        .fn()
        .mockResolvedValue([missingTaskId, staleTaskId, activeTaskId, 'tmp']),
      cleanTaskDir: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceService;
    const service = new WorkspaceCleanupService(
      createConfig({
        WORKSPACE_RETENTION_DAYS: 7,
        WORKSPACE_CLEANUP_INTERVAL_MS: 60_000,
      }),
      taskRepo,
      workspace,
    );

    jest
      .useFakeTimers()
      .setSystemTime(new Date('2026-04-12T00:00:00.000Z').getTime());
    const result = await service.runCleanup();
    jest.useRealTimers();

    expect(result).toEqual({ removed: 2, skipped: 1 });
    expect(workspace.cleanTaskDir).toHaveBeenCalledWith(missingTaskId);
    expect(workspace.cleanTaskDir).toHaveBeenCalledWith(staleTaskId);
    expect(workspace.cleanTaskDir).not.toHaveBeenCalledWith(activeTaskId);
  });
});
