import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEvent } from '@/event/entities/task-event.entity';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function normalizeTake(value: number | undefined): number {
  if (!Number.isFinite(value)) return 200;
  return Math.min(Math.max(Math.trunc(value!), 1), 500);
}

function normalizeSkip(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(Math.trunc(value!), 0);
}

@Injectable()
export class EventLogService {
  private readonly logger = new Logger(EventLogService.name);

  constructor(
    @InjectRepository(TaskEvent)
    private readonly eventRepo: Repository<TaskEvent>,
  ) {}

  async record(
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const event = this.eventRepo.create({
        eventName,
        taskId: extractUuid(payload.taskId),
        runId: extractUuid(payload.runId),
        payload,
      });
      await this.eventRepo.save(event);
    } catch (err) {
      this.logger.warn(
        `Failed to persist task event "${eventName}": ${String(err)}`,
      );
    }
  }

  async listTaskEvents(input: {
    taskId: string;
    runId?: string;
    take?: number;
    skip?: number;
  }): Promise<TaskEvent[]> {
    if (!UUID_RE.test(input.taskId)) {
      throw new BadRequestException('taskId 必须是合法 UUID');
    }
    if (input.runId && !UUID_RE.test(input.runId)) {
      throw new BadRequestException('runId 必须是合法 UUID');
    }

    return this.eventRepo.find({
      where: {
        taskId: input.taskId,
        ...(input.runId ? { runId: input.runId } : {}),
      },
      order: { createdAt: 'ASC' },
      take: normalizeTake(input.take),
      skip: normalizeSkip(input.skip),
    });
  }
}
