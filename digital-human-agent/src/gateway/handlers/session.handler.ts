import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { PersonaService } from '../../persona/persona.service';
import { ConversationService } from '../../conversation/conversation.service';
import { DigitalHumanService } from '../../digital-human/digital-human.service';
import { RealtimeSessionRegistry } from '../../realtime-session/realtime-session.registry';
import { SessionMode } from '../../realtime-session/realtime-session.interface';
import { SessionHistoryMessage, WsSessionStartMessage } from '../gateway.types';

/**
 * 处理 `session:start` 消息。
 *
 * 职责：
 * - 验证 personaId
 * - 关闭已有旧会话
 * - 复用或新建 Conversation
 * - 加载历史消息
 * - 创建 RealtimeSession
 * - 如为数字人模式，启动 WebRTC 会话并发送 offer
 * - 发送 `session:ready`
 */
@Injectable()
export class SessionHandler {
  private readonly logger = new Logger(SessionHandler.name);
  private readonly historyLimit: number;

  constructor(
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    private readonly digitalHumanService: DigitalHumanService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
  ) {
    this.historyLimit = Math.min(
      Math.max(Number(process.env.SESSION_HISTORY_LIMIT ?? 80), 1),
      500,
    );
  }

  async handle(
    client: WebSocket,
    clientId: string,
    msg: WsSessionStartMessage,
    cleanupSession: (sessionId: string) => Promise<void>,
  ): Promise<void> {
    const { personaId } = msg.payload ?? {};
    if (!personaId) {
      this.sendJson(client, {
        type: 'error',
        sessionId: '',
        payload: { message: 'personaId required' },
      });
      return;
    }

    const mode = this.parseMode(msg.payload?.mode);

    // 关闭旧会话
    const oldSession = this.sessionRegistry.findByWsClientId(clientId);
    if (oldSession) {
      await cleanupSession(oldSession.sessionId);
    }

    // 验证 persona
    await this.personaService.findOne(personaId);

    // 复用或新建 Conversation
    const lastConversation =
      await this.conversationService.getLatestConversationByPersona(personaId);
    const conversation =
      lastConversation ??
      (await this.conversationService.createConversation(personaId));

    const history = await this.conversationService.getRecentMessages(
      conversation.id,
      this.historyLimit,
    );

    const sessionId = uuidv4();

    this.sessionRegistry.create(sessionId, {
      conversationId: conversation.id,
      personaId,
      mode,
      digitalHumanSessionId: null,
      iceUnsubscribe: null,
      activeTurnId: null,
      abortController: null,
      sentenceBuffer: '',
      ttsTurnId: null,
      ttsQueue: [],
      ttsProcessing: false,
      ttsSeq: 0,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      speakQueue: [],
      speakProcessing: false,
      wsClientId: clientId,
    });

    if (mode === 'digital-human') {
      await this.startDigitalHumanSession(client, sessionId, personaId);
    }

    this.sendJson(client, {
      type: 'session:ready',
      sessionId,
      payload: {
        conversationId: conversation.id,
        mode,
        history: history.map<SessionHistoryMessage>((m) => ({
          id: m.id,
          turnId: m.turnId,
          role: m.role,
          content: m.content,
          status: m.status,
          createdAt: m.createdAt,
        })),
        historyLimit: this.historyLimit,
      },
    });

    this.logger.log(
      `Session started: ${sessionId} persona=${personaId} mode=${mode}`,
    );
  }

  private async startDigitalHumanSession(
    client: WebSocket,
    sessionId: string,
    personaId: string,
  ): Promise<void> {
    const created = await this.digitalHumanService.createSession(personaId);
    const session = this.sessionRegistry.get(sessionId);

    if (!session) {
      await this.digitalHumanService.closeSession(created.sessionId);
      return;
    }

    const unsubscribe = this.digitalHumanService.onIceCandidate(
      created.sessionId,
      (candidate) => {
        this.sendJson(client, {
          type: 'webrtc:ice-candidate',
          sessionId,
          payload: { candidate },
        });
      },
    );

    this.sessionRegistry.update(sessionId, {
      digitalHumanSessionId: created.sessionId,
      iceUnsubscribe: unsubscribe,
    });

    this.sendJson(client, {
      type: 'webrtc:offer',
      sessionId,
      payload: {
        digitalSessionId: created.sessionId,
        sdpOffer: created.sdpOffer,
        mock: !created.sdpOffer,
      },
    });
  }

  private parseMode(mode: unknown): SessionMode {
    return mode === 'digital-human' ? 'digital-human' : 'voice';
  }

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
