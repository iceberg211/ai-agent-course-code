import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PersonaController } from '@/persona/persona.controller';
import { PersonaService } from '@/persona/persona.service';
import { RequestNormalizePipe } from '@/common/pipes/request-normalize.pipe';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

describe('Persona API (e2e)', () => {
  let app: INestApplication;
  const personaId = '44444444-4444-4444-8444-444444444444';
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PersonaController],
      providers: [
        {
          provide: PersonaService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 'mock-user-id', username: 'mock-user', role: 'user' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new RequestNormalizePipe(),
      new ValidationPipe({
        transform: true,
        whitelist: true,
        validationError: { target: false, value: false },
        exceptionFactory: (errors: ValidationError[]) =>
          new BadRequestException({
            message: '请求参数校验失败',
            errors: errors.map((e) => ({
              field: e.property,
              errors: Object.values(e.constraints ?? {}),
            })),
          }),
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /personas 返回角色列表', async () => {
    service.findAll.mockResolvedValue([
      {
        id: 'p-1',
        name: '李老师',
        createdAt: '2026-04-10T00:00:00.000Z',
      },
    ]);

    const res = await request(app.getHttpServer()).get('/personas').expect(200);
    expect(res.body).toEqual([
      {
        id: 'p-1',
        name: '李老师',
        createdAt: '2026-04-10T00:00:00.000Z',
      },
    ]);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });

  it('POST /personas 创建角色成功', async () => {
    service.create.mockResolvedValue({
      id: 'p-2',
      name: '前端讲师',
      speakingStyle: '温和',
      expertise: ['Vue', 'TypeScript'],
      voiceId: 'longxiaochun',
    });

    const body = {
      name: '前端讲师',
      speakingStyle: '温和',
      expertise: ['Vue', 'TypeScript'],
      voiceId: 'longxiaochun',
    };

    const res = await request(app.getHttpServer())
      .post('/personas')
      .send(body)
      .expect(201);

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '前端讲师',
        speakingStyle: '温和',
        expertise: ['Vue', 'TypeScript'],
        voiceId: 'longxiaochun',
      }),
    );
    expect(res.body).toEqual({
      id: 'p-2',
      name: '前端讲师',
      speakingStyle: '温和',
      expertise: ['Vue', 'TypeScript'],
      voiceId: 'longxiaochun',
    });
  });

  it('POST /personas 支持 snake_case 字段', async () => {
    service.create.mockResolvedValue({
      id: 'p-2b',
      name: '后端专家',
      speakingStyle: '直接',
      expertise: ['NestJS'],
      voiceId: 'longxiaochun',
    });

    const res = await request(app.getHttpServer())
      .post('/personas')
      .send({
        persona_name: '后端专家',
        speaking_style: '直接',
        expertise_list: ['NestJS'],
        voice_id: 'longxiaochun',
      })
      .expect(201);

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '后端专家',
        speakingStyle: '直接',
        expertise: ['NestJS'],
        voiceId: 'longxiaochun',
      }),
    );
    expect(res.body).toEqual({
      id: 'p-2b',
      name: '后端专家',
      speakingStyle: '直接',
      expertise: ['NestJS'],
      voiceId: 'longxiaochun',
    });
  });

  it('POST /personas 缺少 name 时返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .send({ description: '无名称' })
      .expect(400);

    expect(res.body).toEqual(
      expect.objectContaining({
        message: '请求参数校验失败',
      }),
    );
  });

  it('DELETE /personas/:id 删除角色', async () => {
    service.remove.mockResolvedValue({
      id: personaId,
      deleted: true,
    });

    const res = await request(app.getHttpServer())
      .delete(`/personas/${personaId}`)
      .expect(200);

    expect(res.body).toEqual({
      id: personaId,
      deleted: true,
    });
    expect(service.remove).toHaveBeenCalledWith(personaId);
  });

  it('GET /personas/:id 非 UUID 返回 400', async () => {
    await request(app.getHttpServer()).get('/personas/not-a-uuid').expect(400);
    expect(service.findOne).not.toHaveBeenCalled();
  });
});
