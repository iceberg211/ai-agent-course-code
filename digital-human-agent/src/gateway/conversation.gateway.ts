import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { RealtimeSessionRegistry } from '../realtime-session/realtime-session.registry';
import { DIGITAL_HUMAN_PROVIDER } from '../digital-human/digital-human.constants';
import type { DigitalHumanProvider } from '../digital-human/digital-human.types';
import { SessionHandler } from './handlers/session.handler';
import { AudioHandler } from './handlers/audio.handler';
import { TextHandler } from './handlers/text.handler';
import { InterruptHandler } from './handlers/interrupt.handler';
import { WsInboundMessage } from './gateway.types';

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
export class ConversationGateway implements OnModuleInit {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(ConversationGateway.name);

  /** clientId → WebSocket */
  private readonly clients = new Map<string, WebSocket>();

  constructor(
    private readonly sessionRegistry: RealtimeSessionRegistry,
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
    private readonly sessionHandler: SessionHandler,
    private readonly audioHandler: AudioHandler,
    private readonly textHandler: TextHandler,
    private readonly interruptHandler: InterruptHandler,
  ) {}

  onModuleInit(): void {
    this.server?.on('connection', (client: WebSocket) => {
      const clientId = uuidv4();
      (client as WebSocket & { __clientId: string }).__clientId = clientId;
      this.clients.set(clientId, client);
      this.logger.log(`Client connected: ${clientId}`);

      client.on('message', (data: Buffer, isBinary: boolean) => {
        void this.handleMessage(client, clientId, data, isBinary).catch(
          (err) => {
            this.logger.error(
              `Handle message failed: ${
                err instanceof Error ? (err.stack ?? err.message) : String(err)
              }`,
            );
            this.sendJson(client, {
              type: 'error',
              sessionId: '',
              payload: { message: '消息处理失败' },
            });
          },
        );
      });

      client.on('close', (code: number, reason: Buffer) => {
        this.logger.log(
          `Client closing: ${clientId} code=${code} reason=${reason?.toString() ?? ''}`,
        );
        void this.cleanupClientById(clientId);
      });
    });
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

    let msg: WsInboundMessage;
    try {
      msg = JSON.parse(data.toString('utf-8')) as WsInboundMessage;
    } catch {
      this.sendJson(client, {
        type: 'error',
        sessionId: '',
        payload: { message: 'Invalid JSON' },
      });
      return;
    }

    switch (msg.type) {
      case 'ping':
        this.sendJson(client, {
          type: 'pong',
          sessionId: '',
          payload: { ts: Date.now() },
        });
        break;

      case 'session:start':
        await this.sessionHandler.handle(
          client,
          clientId,
          msg,
          (sessionId) => this.cleanupSession(sessionId),
        );
        break;

      case 'conversation:text':
        await this.textHandler.handle(client, clientId, msg);
        break;

      case 'conversation:interrupt':
        await this.interruptHandler.handle(client, msg);
        break;

      default:
        this.logger.warn(`Unknown message type: ${(msg as WsInboundMessage).type}`);
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
      await this.digitalHumanProvider.closeSession(session.digitalHumanSessionId);
    }
    this.sessionRegistry.delete(sessionId);
  }

  // ── 工具方法 ───────────────────────────────────────────────────────────────

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
