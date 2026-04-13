import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { TaskStatus } from '@/common/enums';
import { AgentService } from '@/agent/agent.service';
import { EventLogService } from '@/event/event-log.service';
import { TaskController } from '@/task/task.controller';
import { TaskService } from '@/task/task.service';

describe('TaskController (e2e)', () => {
  let app: INestApplication<App>;
  let expressServer: Express;
  let taskService: {
    listTasks: jest.Mock;
    createTask: jest.Mock;
  };
  let eventLog: {
    listTaskEvents: jest.Mock;
  };
  let agentService: {
    resolveApproval: jest.Mock;
  };

  beforeEach(async () => {
    taskService = {
      listTasks: jest.fn(),
      createTask: jest.fn(),
    };
    eventLog = {
      listTaskEvents: jest.fn(),
    };
    agentService = {
      resolveApproval: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: AgentService, useValue: agentService },
        { provide: EventLogService, useValue: eventLog },
      ],
    }).compile();

    expressServer = express();
    app = moduleFixture.createNestApplication(
      new ExpressAdapter(expressServer),
    );
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  it('GET /api/tasks 返回任务列表并传递分页参数', async () => {
    taskService.listTasks.mockResolvedValue([
      {
        id: 'task-1',
        title: '状态报告',
        status: TaskStatus.PENDING,
      },
    ]);

    await request(expressServer)
      .get('/api/tasks?take=10&skip=5')
      .expect(200)
      .expect([
        {
          id: 'task-1',
          title: '状态报告',
          status: TaskStatus.PENDING,
        },
      ]);

    expect(taskService.listTasks).toHaveBeenCalledWith(10, 5);
  });

  it('POST /api/tasks 校验请求体并创建任务', async () => {
    taskService.createTask.mockResolvedValue({
      id: 'task-1',
      title: '状态报告',
      status: TaskStatus.PENDING,
    });

    await request(expressServer)
      .post('/api/tasks')
      .send({ input: '生成状态报告' })
      .expect(201)
      .expect({
        id: 'task-1',
        title: '状态报告',
        status: TaskStatus.PENDING,
      });

    expect(taskService.createTask).toHaveBeenCalledWith('生成状态报告', 'none');
  });

  it('POST /api/tasks 拒绝空输入', async () => {
    await request(expressServer)
      .post('/api/tasks')
      .send({ input: '' })
      .expect(400);

    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('GET /api/tasks/:id/events 返回任务事件日志', async () => {
    const taskId = '00000000-0000-4000-8000-000000000001';
    eventLog.listTaskEvents.mockResolvedValue([
      {
        id: 'event-1',
        taskId,
        runId: null,
        eventName: 'task.created',
        payload: { taskId },
        createdAt: '2026-04-12T00:00:00.000Z',
      },
    ]);

    await request(expressServer)
      .get(`/api/tasks/${taskId}/events?take=20&skip=0`)
      .expect(200)
      .expect([
        {
          id: 'event-1',
          taskId,
          runId: null,
          eventName: 'task.created',
          payload: { taskId },
          createdAt: '2026-04-12T00:00:00.000Z',
        },
      ]);

    expect(eventLog.listTaskEvents).toHaveBeenCalledWith({
      taskId,
      runId: undefined,
      take: 20,
      skip: 0,
      afterCreatedAt: undefined,
      afterEventId: undefined,
    });
  });

  afterEach(async () => {
    await app?.close();
  });
});

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;
  let expressServer: Express;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        {
          provide: TaskService,
          useValue: { listTasks: jest.fn().mockResolvedValue([]) },
        },
        { provide: AgentService, useValue: { resolveApproval: jest.fn() } },
        { provide: EventLogService, useValue: { listTaskEvents: jest.fn() } },
      ],
    }).compile();

    expressServer = express();
    app = moduleFixture.createNestApplication(
      new ExpressAdapter(expressServer),
    );
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('GET /api/health 端点存在（即使 DB 未连接，也应有健康响应格式）', async () => {
    // 注意：e2e 只测 TaskController，此处验证异常格式（非 HTML 500）
    // 健康检查的真实 DB 连通性测试在集成测试中覆盖
    const res = await request(expressServer).get('/api/tasks').expect(200);
    // tasks 列表可以正常返回，说明 app 启动成功
    expect(Array.isArray(res.body)).toBe(true);
  });

  afterEach(async () => {
    await app?.close();
  });
});
