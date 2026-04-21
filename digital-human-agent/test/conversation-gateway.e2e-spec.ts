import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import WebSocket, { RawData } from 'ws';
import { DIGITAL_HUMAN_PROVIDER } from '@/common/constants';
import { ConversationService } from '@/conversation/conversation.service';
import { AsrService } from '@/asr/asr.service';
import { SessionHandler } from '@/gateway/handlers/session.handler';
import { AudioHandler } from '@/gateway/handlers/audio.handler';
import { TextHandler } from '@/gateway/handlers/text.handler';
import { InterruptHandler } from '@/gateway/handlers/interrupt.handler';
import { ConversationGateway } from '@/gateway/conversation.gateway';
import { AgentPipelineService } from '@/gateway/pipeline/agent-pipeline.service';
import { PersonaService } from '@/persona/persona.service';
import { RealtimeSessionRegistry } from '@/realtime-session/realtime-session.registry';

type JsonMessage = Record<string, unknown>;

jest.mock('uuid', () => {
  let mockUuidCounter = 0;
  return {
    v4: () => `mock-uuid-${++mockUuidCounter}`,
  };
});

describe('Conversation Gateway (e2e)', () => {
  let app: INestApplication;
  let wsBaseUrl: string;

  const personaId = '491a6f8f-739a-47ff-94fa-6382ed79baf9';
  const conversationId = '32852c62-e672-456f-8391-da1f24c1dbfa';

  const personaService = {
    findOne: jest.fn(),
  };

  const conversationService = {
    createConversation: jest.fn(),
    getLatestConversationByPersona: jest.fn(),
    getRecentMessages: jest.fn(),
    addMessage: jest.fn(),
  };

  const asrService = {
    recognize: jest.fn(),
  };

  const agentPipeline = {
    run: jest.fn(),
  };

  const interruptHandler = {
    handle: jest.fn(),
  };

  const digitalHumanProvider = {
    name: 'mock',
    createSession: jest.fn(),
    closeSession: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationGateway,
        RealtimeSessionRegistry,
        SessionHandler,
        AudioHandler,
        TextHandler,
        { provide: InterruptHandler, useValue: interruptHandler },
        { provide: PersonaService, useValue: personaService },
        { provide: ConversationService, useValue: conversationService },
        { provide: AsrService, useValue: asrService },
        { provide: AgentPipelineService, useValue: agentPipeline },
        { provide: DIGITAL_HUMAN_PROVIDER, useValue: digitalHumanProvider },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    wsBaseUrl = `ws://127.0.0.1:${address.port}/ws/conversation`;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    personaService.findOne.mockResolvedValue({
      id: personaId,
      name: '李老师',
      voiceId: 'longxiaochun',
    });

    conversationService.getLatestConversationByPersona.mockResolvedValue({
      id: conversationId,
      personaId,
    });

    conversationService.createConversation.mockResolvedValue({
      id: conversationId,
      personaId,
    });

    conversationService.getRecentMessages.mockResolvedValue([]);
    conversationService.addMessage.mockResolvedValue(undefined);

    asrService.recognize.mockResolvedValue('帮我总结一下产品能力');

    digitalHumanProvider.createSession.mockResolvedValue({
      providerSessionId: 'dh-session-1',
      speakMode: 'pcm-stream',
      credentials: { token: 'mock-token' },
    });
    digitalHumanProvider.closeSession.mockResolvedValue(undefined);

    agentPipeline.run.mockImplementation(
      async (
        client: WebSocket,
        session: { sessionId: string },
        text: string,
        turnId: string,
      ) => {
        client.send(
          JSON.stringify({
            type: 'conversation:start',
            sessionId: session.sessionId,
            turnId,
          }),
        );
        client.send(
          JSON.stringify({
            type: 'conversation:text_chunk',
            sessionId: session.sessionId,
            turnId,
            payload: { token: `已收到：${text}` },
          }),
        );
        client.send(
          JSON.stringify({
            type: 'conversation:done',
            sessionId: session.sessionId,
            turnId,
            payload: { status: 'completed' },
          }),
        );
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('session:start 返回 session:ready', async () => {
    const socket = await connectSocket(wsBaseUrl);
    const collector = createMessageCollector(socket);

    try {
      socket.send(
        JSON.stringify({
          type: 'session:start',
          payload: { personaId, mode: 'voice' },
        }),
      );

      const readyMessage = await collector.waitFor('session:ready');

      expect(personaService.findOne).toHaveBeenCalledWith(personaId);
      expect(
        conversationService.getLatestConversationByPersona,
      ).toHaveBeenCalledWith(personaId);
      expect(readyMessage).toEqual(
        expect.objectContaining({
          type: 'session:ready',
          payload: expect.objectContaining({
            conversationId,
            mode: 'voice',
            history: [],
          }),
        }),
      );
    } finally {
      collector.dispose();
      socket.close();
    }
  });

  it('conversation:text 触发文字对话链路', async () => {
    const socket = await connectSocket(wsBaseUrl);
    const collector = createMessageCollector(socket);

    try {
      socket.send(
        JSON.stringify({
          type: 'session:start',
          payload: { personaId, mode: 'voice' },
        }),
      );

      const readyMessage = await collector.waitFor('session:ready');
      const sessionId = String(readyMessage.sessionId);

      socket.send(
        JSON.stringify({
          type: 'conversation:text',
          sessionId,
          payload: { text: '介绍一下企业知识库' },
        }),
      );

      const startMessage = await collector.waitFor('conversation:start');
      const textChunkMessage = await collector.waitFor('conversation:text_chunk');
      const doneMessage = await collector.waitFor('conversation:done');

      expect(conversationService.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          role: 'user',
          content: '介绍一下企业知识库',
          status: 'completed',
        }),
      );
      expect(agentPipeline.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId,
          conversationId,
          personaId,
        }),
        '介绍一下企业知识库',
        expect.any(String),
      );
      expect(startMessage.type).toBe('conversation:start');
      expect(textChunkMessage).toEqual(
        expect.objectContaining({
          type: 'conversation:text_chunk',
          payload: { token: '已收到：介绍一下企业知识库' },
        }),
      );
      expect(doneMessage).toEqual(
        expect.objectContaining({
          type: 'conversation:done',
          payload: { status: 'completed' },
        }),
      );
    } finally {
      collector.dispose();
      socket.close();
    }
  });

  it('二进制音频触发 ASR 和语音对话链路', async () => {
    const socket = await connectSocket(wsBaseUrl);
    const collector = createMessageCollector(socket);

    try {
      socket.send(
        JSON.stringify({
          type: 'session:start',
          payload: { personaId, mode: 'voice' },
        }),
      );

      const readyMessage = await collector.waitFor('session:ready');
      const sessionId = String(readyMessage.sessionId);

      socket.send(Buffer.from('mock-audio-bytes'));

      const asrMessage = await collector.waitFor('asr:final');
      const startMessage = await collector.waitFor('conversation:start');
      const doneMessage = await collector.waitFor('conversation:done');

      expect(asrService.recognize).toHaveBeenCalledWith(
        expect.any(Buffer),
      );
      expect(conversationService.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          role: 'user',
          content: '帮我总结一下产品能力',
          status: 'completed',
        }),
      );
      expect(agentPipeline.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId,
          conversationId,
          personaId,
        }),
        '帮我总结一下产品能力',
        expect.any(String),
      );
      expect(asrMessage).toEqual(
        expect.objectContaining({
          type: 'asr:final',
          sessionId,
          payload: { text: '帮我总结一下产品能力' },
        }),
      );
      expect(startMessage.type).toBe('conversation:start');
      expect(doneMessage.type).toBe('conversation:done');
    } finally {
      collector.dispose();
      socket.close();
    }
  });
});

async function connectSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket 连接超时'));
    }, 2000);

    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return socket;
}

function createMessageCollector(socket: WebSocket) {
  const queue: JsonMessage[] = [];
  const waiters = new Map<
    string,
    Array<{ resolve: (msg: JsonMessage) => void; reject: (error: Error) => void }>
  >();

  const onMessage = (raw: RawData) => {
    try {
      const message = JSON.parse(raw.toString()) as JsonMessage;
      const type = String(message.type ?? '');
      const pending = waiters.get(type);
      if (pending && pending.length > 0) {
        const current = pending.shift();
        current?.resolve(message);
        return;
      }
      queue.push(message);
    } catch {
      // 忽略非 JSON 消息
    }
  };

  const onError = (error: Error) => {
    for (const items of waiters.values()) {
      while (items.length > 0) {
        items.shift()?.reject(error);
      }
    }
  };

  socket.on('message', onMessage);
  socket.on('error', onError);

  return {
    waitFor(type: string): Promise<JsonMessage> {
      const index = queue.findIndex((message) => message.type === type);
      if (index >= 0) {
        return Promise.resolve(queue.splice(index, 1)[0]);
      }

      return new Promise<JsonMessage>((resolve, reject) => {
        let wrappedResolve: (message: JsonMessage) => void;
        let wrappedReject: (error: Error) => void;
        const timer = setTimeout(() => {
          const list = waiters.get(type) ?? [];
          waiters.set(
            type,
            list.filter((item) => item.resolve !== wrappedResolve),
          );
          reject(new Error(`等待消息超时: ${type}`));
        }, 2000);

        wrappedResolve = (message: JsonMessage) => {
          clearTimeout(timer);
          resolve(message);
        };
        wrappedReject = (error: Error) => {
          clearTimeout(timer);
          reject(error);
        };

        const list = waiters.get(type) ?? [];
        list.push({ resolve: wrappedResolve, reject: wrappedReject });
        waiters.set(type, list);
      });
    },
    dispose() {
      socket.off('message', onMessage);
      socket.off('error', onError);
      queue.length = 0;
      waiters.clear();
    },
  };
}
