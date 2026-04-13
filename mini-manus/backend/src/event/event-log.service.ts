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

function parseCursorDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('after_created_at 必须是合法时间字符串');
  }
  return date;
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
        id: extractUuid(payload._eventId) ?? undefined,
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
    afterCreatedAt?: string;
    afterEventId?: string;
  }): Promise<TaskEvent[]> {
    if (!UUID_RE.test(input.taskId)) {
      throw new BadRequestException('taskId 必须是合法 UUID');
    }
    if (input.runId && !UUID_RE.test(input.runId)) {
      throw new BadRequestException('runId 必须是合法 UUID');
    }
    if (input.afterEventId && !UUID_RE.test(input.afterEventId)) {
      throw new BadRequestException('after_event_id 必须是合法 UUID');
    }

    const afterCreatedAt = parseCursorDate(input.afterCreatedAt);
    if ((afterCreatedAt && !input.afterEventId) || (!afterCreatedAt && input.afterEventId)) {
      throw new BadRequestException('after_created_at 和 after_event_id 必须同时提供');
    }

    const query = this.eventRepo
      .createQueryBuilder('event')
      .where('event.taskId = :taskId', { taskId: input.taskId })
      .orderBy('event.createdAt', 'ASC')
      .addOrderBy('event.id', 'ASC')
      .take(normalizeTake(input.take));

    if (input.runId) {
      query.andWhere('event.runId = :runId', { runId: input.runId });
    }

    if (afterCreatedAt && input.afterEventId) {
      query.andWhere(
        '(event.createdAt > :afterCreatedAt OR (event.createdAt = :afterCreatedAt AND event.id > :afterEventId))',
        {
          afterCreatedAt,
          afterEventId: input.afterEventId,
        },
      );
    } else {
      query.skip(normalizeSkip(input.skip));
    }

    return query.getMany();
  }
}
