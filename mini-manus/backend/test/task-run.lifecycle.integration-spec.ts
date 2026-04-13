import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { RunStatus, TaskStatus } from '@/common/enums';
import { Task } from '@/task/entities/task.entity';
import { TaskRevision } from '@/task/entities/task-revision.entity';
import { TaskRun } from '@/task/entities/task-run.entity';
import { TaskEvent } from '@/event/entities/task-event.entity';

function requireSafeTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  }
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(databaseName) && process.env.ALLOW_NON_TEST_DATABASE !== '1') {
    throw new Error(
      'Refusing to run destructive integration tests: database name must include "test" or set ALLOW_NON_TEST_DATABASE=1',
    );
  }
  return url;
}

describe('Task/Run lifecycle (PostgreSQL integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requireSafeTestDatabaseUrl(),
      ssl:
        process.env.TEST_DATABASE_SSL === 'false'
          ? false
          : { rejectUnauthorized: false },
      entities: [join(__dirname, '..', 'src', '**', '*.entity.{ts,js}')],
      migrations: [join(__dirname, '..', 'src', 'migrations', '*.{ts,js}')],
      synchronize: false,
      dropSchema: true,
      logging: false,
    });

    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('runs migrations and persists task, run token/model stats, relations and events', async () => {
    const taskRepo = dataSource.getRepository(Task);
    const revisionRepo = dataSource.getRepository(TaskRevision);
    const runRepo = dataSource.getRepository(TaskRun);
    const eventRepo = dataSource.getRepository(TaskEvent);

    const task = await taskRepo.save(
      taskRepo.create({
        title: 'PostgreSQL 集成测试任务',
        status: TaskStatus.PENDING,
      }),
    );
    const revision = await revisionRepo.save(
      revisionRepo.create({
        taskId: task.id,
        version: 1,
        input: '验证 task -> revision -> run 生命周期',
      }),
    );
    const run = await runRepo.save(
      runRepo.create({
        taskId: task.id,
        revisionId: revision.id,
        runNumber: 1,
        status: RunStatus.RUNNING,
        cancelRequested: false,
        approvalMode: 'none',
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        estimatedCostUsd: 0.000015,
        modelName: 'gpt-4o-mini',
      }),
    );

    await taskRepo.update(task.id, {
      status: TaskStatus.RUNNING,
      currentRevisionId: revision.id,
      currentRunId: run.id,
    });
    await runRepo.update(run.id, {
      status: RunStatus.COMPLETED,
      completedAt: new Date(),
    });

    const eventId = randomUUID();
    await eventRepo.save(
      eventRepo.create({
        id: eventId,
        taskId: task.id,
        runId: run.id,
        eventName: 'run.completed',
        payload: {
          _eventId: eventId,
          _eventName: 'run.completed',
          taskId: task.id,
          runId: run.id,
        },
      }),
    );

    const loadedTask = await taskRepo.findOneOrFail({
      where: { id: task.id },
      relations: ['revisions', 'runs'],
    });
    const loadedRun = await runRepo.findOneOrFail({ where: { id: run.id } });
    const loadedEvent = await eventRepo.findOneOrFail({ where: { id: eventId } });

    expect(loadedTask.currentRevisionId).toBe(revision.id);
    expect(loadedTask.currentRunId).toBe(run.id);
    expect(loadedTask.revisions).toHaveLength(1);
    expect(loadedTask.runs).toHaveLength(1);
    expect(loadedRun.status).toBe(RunStatus.COMPLETED);
    expect(loadedRun.modelName).toBe('gpt-4o-mini');
    expect(loadedRun.totalTokens).toBe(20);
    expect(loadedEvent.payload['_eventId']).toBe(eventId);
  });
});
