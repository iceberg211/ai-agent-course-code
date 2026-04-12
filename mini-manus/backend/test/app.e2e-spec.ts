import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { TaskStatus } from '@/common/enums';
import { TaskController } from '@/task/task.controller';
import { TaskService } from '@/task/task.service';

describe('TaskController (e2e)', () => {
  let app: INestApplication<App>;
  let expressServer: Express;
  let taskService: {
    listTasks: jest.Mock;
    createTask: jest.Mock;
  };

  beforeEach(async () => {
    taskService = {
      listTasks: jest.fn(),
      createTask: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [{ provide: TaskService, useValue: taskService }],
    }).compile();

    expressServer = express();
    app = moduleFixture.createNestApplication(new ExpressAdapter(expressServer));
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

    expect(taskService.createTask).toHaveBeenCalledWith('生成状态报告');
  });

  it('POST /api/tasks 拒绝空输入', async () => {
    await request(expressServer)
      .post('/api/tasks')
      .send({ input: '' })
      .expect(400);

    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    await app.close();
  });
});
