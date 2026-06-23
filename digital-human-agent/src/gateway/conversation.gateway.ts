import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  DIGITAL_HUMAN_PROVIDER,
  GATEWAY_HEARTBEAT_INTERVAL,
} from '@/common/constants';
import { AccessControlService } from '@/common/security/access-control.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { SessionHandler } from '@/gateway/handlers/session.handler';
import { AudioHandler } from '@/gateway/handlers/audio.handler';
import { TextHandler } from '@/gateway/handlers/text.handler';
import { InterruptHandler } from '@/gateway/handlers/interrupt.handler';
import { WsInboundMessage } from '@/gateway/gateway.types';
import { sendJson } from '@/gateway/utils/ws-send.util';
import { validateInboundMessage } from '@/gateway/utils/ws-validate.util';

/** NestJS HttpException 的结构接口，用于类型守卫以替代 as any */
interface NestHttpException {
  getStatus(): number;
  getResponse(): string | Record<string, unknown>;
  message: string;
}

/** 判断 err 是否为 NestJS HttpException 的类型守卫函数 */
function isNestHttpException(err: unknown): err is NestHttpException {
  return (
    err !== null &&
    typeof err === 'object' &&
    'getStatus' in err &&
    'getResponse' in err &&
    typeof (err as NestHttpException).getStatus === 'function' &&
    typeof (err as NestHttpException).getResponse === 'function'
  );
}

/**
 * ConversationGateway — WebSocket 入口与消息路由。
 *
 * 职责仅限于：
 * 1. 管理 WebSocket 客户端连接（connect / disconnect）
 * 2. 将入站消息路由到对应的 Handler
 * 3. 会话清理（cleanupSession / cleanupClientById）
 *
 * 所有业务逻辑均委托给各 Handler 和 Pipeline 服务。
 */
@Injectable()
@WebSocketGateway({ path: '/ws/conversation' })
export class ConversationGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(ConversationGateway.name);

  /** clientId → WebSocket */
  private readonly clients = new Map<string, WebSocket>();

  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    private readonly sessionRegistry: RealtimeSessionRegistry,
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
    private readonly sessionHandler: SessionHandler,
    private readonly audioHandler: AudioHandler,
    private readonly textHandler: TextHandler,
    private readonly interruptHandler: InterruptHandler,
    private readonly accessControl: AccessControlService,
  ) {}

  onModuleInit(): void {
    this.server?.on(
      'connection',
      (client: WebSocket, request: IncomingMessage) => {
        const clientId = randomUUID();
        if (!this.accessControl.validateWsRequest(request)) {
          client.close(1008, 'Unauthorized');
          this.logger.warn(`Client rejected by access token: ${clientId}`);
          return;
        }

        const clientWithState = client as WebSocket & {
          __clientId: string;
          isAlive: boolean;
        };
        clientWithState.__clientId = clientId;
        clientWithState.isAlive = true;

        this.clients.set(clientId, client);
        this.logger.log(`Client connected: ${clientId}`);

        client.on('pong', () => {
          clientWithState.isAlive = true;
        });

        client.on('message', (data: Buffer, isBinary: boolean) => {
          clientWithState.isAlive = true;
          void this.handleMessage(client, clientId, data, isBinary).catch(
            (err) => {
              // T-1 修复：用类型守卫替代 as any，消除类型不安全的强制断言
              if (isNestHttpException(err)) {
                const response = err.getResponse();
                const message =
                  typeof response === 'object' &&
                  response !== null &&
                  'message' in response
                    ? Array.isArray(response.message)
                      ? response.message.join('; ')
                      : String(response.message)
                    : err.message || '业务请求失败';

                this.logger.warn(`Ws business exception: ${message}`);
                sendJson(client, {
                  type: 'error',
                  sessionId: '',
                  payload: { message },
                });
              } else {
                this.logger.error(
                  `Handle message failed: ${
                    err instanceof Error
                      ? (err.stack ?? err.message)
                      : String(err)
                  }`,
                );
                sendJson(client, {
                  type: 'error',
                  sessionId: '',
                  payload: { message: '服务器内部错误' },
                });
              }
            },
          );
        });

        client.on('close', (code: number, reason: Buffer) => {
          this.logger.log(
            `Client closing: ${clientId} code=${code} reason=${reason?.toString() ?? ''}`,
          );
          void this.cleanupClientById(clientId);
        });
      },
    );

    // 启动保活定时器
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, clientId) => {
        const clientWithState = client as WebSocket & { isAlive: boolean };
        if (clientWithState.isAlive === false) {
          this.logger.warn(
            `Client heartbeat timeout, terminating connection: ${clientId}`,
          );
          client.terminate();
          return;
        }
        clientWithState.isAlive = false;
        client.ping();
      });
    }, GATEWAY_HEARTBEAT_INTERVAL);
  }

  onModuleDestroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    // 主动关闭所有活跃客户端连接，防止内存泄漏和悬空 TCP
    this.clients.forEach((client, clientId) => {
      try {
        client.close(1001, 'Going Away');
      } catch (err) {
        this.logger.warn(
          `Failed to close client ${clientId} on destroy: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
    this.clients.clear();
  }

  // ── 消息路由 ────────────────────────────────────────────────────────────────

  private async handleMessage(
    client: WebSocket,
    clientId: string,
    data: Buffer,
    isBinary: boolean,
  ): Promise<void> {
    // 二进制 → 麦克风音频
    if (isBinary) {
      await this.audioHandler.handle(client, clientId, data);
      return;
    }

    let rawMsg: unknown;
    try {
      rawMsg = JSON.parse(data.toString('utf-8'));
    } catch {
      sendJson(client, {
        type: 'error',
        sessionId: '',
        payload: { message: 'Invalid JSON' },
      });
      return;
    }

    const validationResult = await validateInboundMessage(rawMsg);
    if (!validationResult.isValid) {
      this.logger.warn(
        `WebSocket 消息校验失败: ${validationResult.errors?.join(', ')}`,
      );
      sendJson(client, {
        type: 'error',
        sessionId: '',
        payload: {
          message: `协议格式错误: ${validationResult.errors?.join('; ')}`,
        },
      });
      return;
    }

    const msg = validationResult.validatedMsg as WsInboundMessage;

    switch (msg.type) {
      case 'ping':
        sendJson(client, {
          type: 'pong',
          sessionId: '',
          payload: { ts: Date.now() },
        });
        break;

      case 'session:start':
        await this.sessionHandler.handle(client, clientId, msg, (sessionId) =>
          this.cleanupSession(sessionId),
        );
        break;

      case 'conversation:text':
        await this.textHandler.handle(client, clientId, msg);
        break;

      case 'conversation:interrupt':
        await this.interruptHandler.handle(client, msg);
        break;

      default:
        this.logger.warn(`Unknown message type: ${(msg as any).type}`);
    }
  }

  // ── 连接清理 ───────────────────────────────────────────────────────────────

  private async cleanupClientById(clientId: string): Promise<void> {
    this.clients.delete(clientId);
    const session = this.sessionRegistry.findByWsClientId(clientId);
    if (session) {
      await this.cleanupSession(session.sessionId);
    }
    this.logger.log(`Client disconnected: ${clientId}`);
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;
    session.abortController?.abort();
    if (session.digitalHumanSessionId) {
      await this.digitalHumanProvider.closeSession(
        session.digitalHumanSessionId,
      );
    }
    this.sessionRegistry.delete(sessionId);
  }
}
