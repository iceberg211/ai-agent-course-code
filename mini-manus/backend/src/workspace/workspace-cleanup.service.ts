import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskStatus } from '@/common/enums';
import { Task } from '@/task/entities/task.entity';
import { WorkspaceService } from '@/workspace/workspace.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function terminalTask(status: TaskStatus): boolean {
  return [
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED,
  ].includes(status);
}

@Injectable()
export class WorkspaceCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceCleanupService.name);
  private readonly enabled: boolean;
  private readonly retentionDays: number;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly workspace: WorkspaceService,
  ) {
    this.enabled = readBoolean(
      this.config.get<string>('WORKSPACE_CLEANUP_ENABLED'),
      false,
    );
    this.retentionDays = this.config.get<number>('WORKSPACE_RETENTION_DAYS', 7);
    this.intervalMs = this.config.get<number>(
      'WORKSPACE_CLEANUP_INTERVAL_MS',
      6 * 60 * 60 * 1000,
    );
  }

  onModuleInit() {
    if (!this.enabled) return;
    void this.runCleanup();
    this.timer = setInterval(() => void this.runCleanup(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runCleanup(): Promise<{ removed: number; skipped: number }> {
    const taskIds = (await this.workspace.listTaskWorkspaceDirs()).filter((id) =>
      UUID_RE.test(id),
    );
    if (taskIds.length === 0) return { removed: 0, skipped: 0 };

    const tasks = await this.taskRepo.find({
      where: { id: In(taskIds) },
      select: ['id', 'status', 'updatedAt'],
    });
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    let removed = 0;
    let skipped = 0;
    for (const taskId of taskIds) {
      const task = taskMap.get(taskId);
      const shouldRemove =
        !task ||
        (terminalTask(task.status) && task.updatedAt.getTime() < cutoff);

      if (!shouldRemove) {
        skipped += 1;
        continue;
      }

      try {
        await this.workspace.cleanTaskDir(taskId);
        removed += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          `Failed to clean workspace for task ${taskId}: ${String(err)}`,
        );
      }
    }

    if (removed > 0) {
      this.logger.log(`Workspace cleanup removed ${removed} task directorie(s)`);
    }
    return { removed, skipped };
  }
}
