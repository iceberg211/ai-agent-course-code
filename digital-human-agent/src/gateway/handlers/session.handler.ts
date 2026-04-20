import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { DIGITAL_HUMAN_PROVIDER } from '@/common/constants';
import { PersonaService } from '@/persona/persona.service';
import { ConversationService } from '@/conversation/conversation.service';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { RealtimeSessionRegistry } from '@/realtime-session/realtime-session.registry';
import { SessionMode } from '@/realtime-session/realtime-session.interface';
import { SessionHistoryMessage, WsSessionStartMessage } from '@/gateway/gateway.types';

/**
 * 处理 `session:start` 消息。
 *
 * 职责：
 * - 验证 personaId
 * - 关闭已有旧会话
 * - 复用或新建 Conversation
 * - 加载历史消息
 * - 创建 RealtimeSession
 * - 如为数字人模式，创建 Provider 会话并发送 credentials
 * - 发送 `session:ready`
 */
@Injectable()
export class SessionHandler {
  private readonly logger = new Logger(SessionHandler.name);
  private readonly historyLimit: number;

  constructor(
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
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
    const forceNew = msg.payload?.forceNew === true;

    // 关闭旧会话
    const oldSession = this.sessionRegistry.findByWsClientId(clientId);
    if (oldSession) {
      await cleanupSession(oldSession.sessionId);
    }

    // 验证 persona
    const persona = await this.personaService.findOne(personaId);

    // 复用或新建 Conversation（forceNew=true 时始终新建）
    const conversation = forceNew
      ? await this.conversationService.createConversation(personaId)
      : ((await this.conversationService.getLatestConversationByPersona(
          personaId,
        )) ?? (await this.conversationService.createConversation(personaId)));

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
      digitalHumanSpeakMode: null,
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
      await this.startDigitalHumanSession(
        client,
        sessionId,
        personaId,
        persona.voiceId ?? undefined,
      );
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
    voiceId?: string,
  ): Promise<void> {
    const created = await this.digitalHumanProvider.createSession(
      personaId,
      voiceId,
    );
    const session = this.sessionRegistry.get(sessionId);

    if (!session) {
      await this.digitalHumanProvider.closeSession(created.providerSessionId);
      return;
    }

    this.sessionRegistry.update(sessionId, {
      digitalHumanSessionId: created.providerSessionId,
      digitalHumanSpeakMode: created.speakMode,
    });

    this.sendJson(client, {
      type: 'digital-human:ready',
      sessionId,
      payload: {
        provider: this.digitalHumanProvider.name,
        digitalSessionId: created.providerSessionId,
        speakMode: created.speakMode,
        credentials: created.credentials,
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
