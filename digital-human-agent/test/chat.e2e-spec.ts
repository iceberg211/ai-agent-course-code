import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgentService } from '@/agent/agent.service';
import { ChatController } from '@/chat/chat.controller';
import { RequestNormalizePipe } from '@/common/pipes/request-normalize.pipe';
import { ConversationService } from '@/conversation/conversation.service';
import { PersonaService } from '@/persona/persona.service';

jest.mock('uuid', () => {
  let mockUuidCounter = 0;
  return {
    v4: () => `mock-uuid-${++mockUuidCounter}`,
  };
});

describe('Chat API (e2e)', () => {
  let app: INestApplication;

  const personaId = '491a6f8f-739a-47ff-94fa-6382ed79baf9';
  const conversationId = '32852c62-e672-456f-8391-da1f24c1dbfa';

  const agentService = {
    run: jest.fn(),
  };

  const conversationService = {
    getConversationById: jest.fn(),
    getLatestConversationByPersona: jest.fn(),
    createConversation: jest.fn(),
    addMessage: jest.fn(),
  };

  const personaService = {
    findOne: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: AgentService, useValue: agentService },
        { provide: ConversationService, useValue: conversationService },
        { provide: PersonaService, useValue: personaService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new RequestNormalizePipe(),
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
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

    personaService.findOne.mockResolvedValue({
      id: personaId,
      name: '李老师',
    });

    conversationService.getLatestConversationByPersona.mockResolvedValue({
      id: conversationId,
      personaId,
    });

    conversationService.createConversation.mockResolvedValue({
      id: conversationId,
      personaId,
    });

    conversationService.addMessage.mockResolvedValue(undefined);

    agentService.run.mockImplementation(
      async ({
        onToken,
        onCitations,
      }: {
        onToken: (token: string) => void;
        onCitations: (citations: unknown[]) => void;
      }) => {
        onToken('你好');
        onToken('，这里是测试回复。');
        onCitations([
          {
            source: '产品 FAQ',
            chunk_index: 1,
            similarity: 0.92,
          },
        ]);
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /chat 支持纯文本 message 入参', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat')
      .send({
        personaId,
        message: '请介绍一下这个系统',
      })
      .expect(200);

    expect(personaService.findOne).toHaveBeenCalledWith(personaId);
    expect(
      conversationService.getLatestConversationByPersona,
    ).toHaveBeenCalledWith(personaId);
    expect(agentService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        personaId,
        userMessage: '请介绍一下这个系统',
      }),
    );
    expect(conversationService.addMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId,
        role: 'user',
        content: '请介绍一下这个系统',
        status: 'completed',
      }),
    );
    expect(conversationService.addMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId,
        role: 'assistant',
        content: '你好，这里是测试回复。',
        status: 'completed',
      }),
    );
    expect(res.headers['x-conversation-id']).toBe(conversationId);
    expect(res.text).toContain('这里是测试回复');
    expect(res.text).toContain('产品 FAQ');
  });

  it('POST /chat 支持 AI SDK messages 入参，并提取最后一条用户文本', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat')
      .send({
        personaId,
        trigger: 'submit-message',
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: '第一句' }],
          },
          {
            role: 'assistant',
            parts: [{ type: 'text', text: '历史回复' }],
          },
          {
            role: 'user',
            parts: [{ type: 'text', text: '最后一个问题' }],
          },
        ],
      })
      .expect(200);

    expect(agentService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: '最后一个问题',
      }),
    );
    expect(res.text).toContain('这里是测试回复');
  });

  it('POST /chat 缺少 personaId 时返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat')
      .send({ message: '你好' })
      .expect(400);

    expect(res.body).toEqual(
      expect.objectContaining({
        message: '请求参数校验失败',
      }),
    );
    expect(agentService.run).not.toHaveBeenCalled();
  });
});
