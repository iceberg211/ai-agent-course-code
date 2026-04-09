import {
  Injectable, Logger, OnModuleInit,
} from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { AgentService } from '../agent/agent.service';
import { AsrService } from '../asr/asr.service';
import { TtsService } from '../tts/tts.service';
import { ConversationService } from '../conversation/conversation.service';
import { PersonaService } from '../persona/persona.service';
import { RealtimeSessionRegistry } from '../realtime-session/realtime-session.registry';
import { RealtimeSession } from '../realtime-session/realtime-session.interface';

@Injectable()
@WebSocketGateway({ path: '/ws/conversation' })
export class ConversationGateway implements OnModuleInit {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(ConversationGateway.name);
  // clientId → WebSocket
  private readonly clients = new Map<string, WebSocket>();

  constructor(
    private readonly agentService: AgentService,
    private readonly asrService: AsrService,
    private readonly ttsService: TtsService,
    private readonly conversationService: ConversationService,
    private readonly personaService: PersonaService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
  ) {}

  onModuleInit() {
    this.server?.on('connection', (client: WebSocket) => {
      const clientId = uuidv4();
      (client as any).__clientId = clientId;
      this.clients.set(clientId, client);
      this.logger.log(`Client connected: ${clientId}`);

      client.on('message', (data: Buffer | string) => {
        this.handleMessage(client, clientId, data);
      });

      client.on('close', () => {
        this.handleDisconnect(clientId);
      });
    });
  }

  // ── 消息路由 ────────────────────────────────────────────────────────

  private async handleMessage(
    client: WebSocket,
    clientId: string,
    data: Buffer | string,
  ) {
    // Binary：麦克风音频
    if (Buffer.isBuffer(data)) {
      await this.handleAudio(client, clientId, data);
      return;
    }

    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.send(client, { type: 'error', sessionId: '', payload: { message: 'Invalid JSON' } });
      return;
    }

    switch (msg.type) {
      case 'session:start':
        await this.handleSessionStart(client, clientId, msg);
        break;
      case 'conversation:interrupt':
        await this.handleInterrupt(msg.sessionId);
        break;
      default:
        this.logger.warn(`Unknown message type: ${msg.type}`);
    }
  }

  // ── session:start ───────────────────────────────────────────────────

  private async handleSessionStart(client: WebSocket, clientId: string, msg: any) {
    const { personaId } = msg.payload ?? {};
    if (!personaId) {
      this.send(client, { type: 'error', sessionId: '', payload: { message: 'personaId required' } });
      return;
    }

    // 关闭旧会话（如果有）
    const oldSession = this.sessionRegistry.findByWsClientId(clientId);
    if (oldSession) {
      await this.cleanupSession(oldSession.sessionId);
    }

    // 创建新会话
    await this.personaService.findOne(personaId); // 验证 persona 存在
    const conversation = await this.conversationService.createConversation(personaId);
    const sessionId = uuidv4();

    this.sessionRegistry.create(sessionId, {
      conversationId: conversation.id,
      personaId,
      activeTurnId: null,
      abortController: null,
      sentenceBuffer: '',
      wsClientId: clientId,
    });

    this.send(client, {
      type: 'session:ready',
      sessionId,
      payload: { conversationId: conversation.id },
    });

    this.logger.log(`Session started: ${sessionId} persona=${personaId}`);
  }

  // ── 音频（ASR） ──────────────────────────────────────────────────────

  private async handleAudio(client: WebSocket, clientId: string, audio: Buffer) {
    const session = this.sessionRegistry.findByWsClientId(clientId);
    if (!session) {
      this.send(client, { type: 'error', sessionId: '', payload: { message: 'No active session' } });
      return;
    }

    let text: string;
    try {
      text = await this.asrService.recognize(audio);
    } catch (err) {
      this.send(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'ASR failed' },
      });
      return;
    }

    if (!text.trim()) return;

    // 推送识别结果
    this.send(client, {
      type: 'asr:final',
      sessionId: session.sessionId,
      payload: { text },
    });

    // 写入用户消息
    const turnId = uuidv4();
    this.sessionRegistry.update(session.sessionId, { activeTurnId: turnId });

    await this.conversationService.addMessage({
      conversationId: session.conversationId,
      turnId,
      role: 'user',
      seq: 0,
      content: text,
      status: 'completed',
    });

    // 启动 Agent
    await this.runAgent(client, session, text, turnId);
  }

  // ── Agent 执行 + TTS 推流 ────────────────────────────────────────────

  private async runAgent(
    client: WebSocket,
    session: RealtimeSession,
    userMessage: string,
    turnId: string,
  ) {
    const abortController = new AbortController();
    this.sessionRegistry.update(session.sessionId, { abortController });

    this.send(client, {
      type: 'conversation:start',
      sessionId: session.sessionId,
      turnId,
    });

    let fullReply = '';

    try {
      await this.agentService.run({
        conversationId: session.conversationId,
        personaId: session.personaId,
        userMessage,
        turnId,
        signal: abortController.signal,
        onToken: (token: string) => {
          fullReply += token;

          // 推送文字 token 给前端
          this.send(client, {
            type: 'conversation:text_chunk',
            sessionId: session.sessionId,
            turnId,
            payload: { token },
          });

          // 按句缓冲 → TTS
          this.flushBuffer(client, session, token, false);
        },
        onCitations: (citations) => {
          this.send(client, {
            type: 'conversation:citations',
            sessionId: session.sessionId,
            turnId,
            payload: { citations },
          });
        },
      });

      // 刷出剩余缓冲
      this.flushBuffer(client, session, '', true);

      const status = abortController.signal.aborted ? 'interrupted' : 'completed';
      await this.conversationService.addMessage({
        conversationId: session.conversationId,
        turnId,
        role: 'assistant',
        seq: 0,
        content: fullReply,
        status,
      });

      this.send(client, {
        type: 'conversation:done',
        sessionId: session.sessionId,
        turnId,
        payload: { status },
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        this.logger.error('Agent run failed', err);
        this.send(client, {
          type: 'error',
          sessionId: session.sessionId,
          payload: { message: 'Agent error' },
        });
      }
    } finally {
      this.sessionRegistry.update(session.sessionId, {
        activeTurnId: null,
        abortController: null,
        sentenceBuffer: '',
      });
    }
  }

  // ── 按句缓冲 ─────────────────────────────────────────────────────────

  private flushBuffer(
    client: WebSocket,
    session: RealtimeSession,
    token: string,
    isEnd: boolean,
  ) {
    session.sentenceBuffer += token;

    const SENTENCE_END = /[。？！；]/;
    const CLAUSE_END = /[，、：]/;

    const shouldFlush =
      SENTENCE_END.test(token) ||
      (CLAUSE_END.test(token) && session.sentenceBuffer.length > 15) ||
      session.sentenceBuffer.length > 50 ||
      isEnd;

    if (shouldFlush && session.sentenceBuffer.trim()) {
      const text = session.sentenceBuffer.trim();
      session.sentenceBuffer = '';
      this.sendTts(client, session, text);
    }
  }

  // ── TTS 推流 ─────────────────────────────────────────────────────────

  private async sendTts(client: WebSocket, session: RealtimeSession, text: string) {
    const turnId = session.activeTurnId ?? '';
    const abortController = session.abortController;

    // 先拿 persona 获取 voiceId
    // 注意：这里不 await，避免阻塞 token 流；TTS 骨架实现时为空操作
    this.personaService.findOne(session.personaId).then(async (persona) => {
      this.send(client, {
        type: 'tts:start',
        sessionId: session.sessionId,
        turnId,
        payload: { encoding: 'mp3' },
      });

      try {
        await this.ttsService.synthesizeStream(
          text,
          persona.voiceId,
          abortController?.signal ?? new AbortController().signal,
          (chunk: Buffer) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(chunk);
            }
          },
        );
      } finally {
        this.send(client, {
          type: 'tts:end',
          sessionId: session.sessionId,
          turnId,
        });
      }
    }).catch((err) => {
      this.logger.error('TTS error', err);
    });
  }

  // ── 打断 ──────────────────────────────────────────────────────────────

  private async handleInterrupt(sessionId: string) {
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;

    session.abortController?.abort();
    this.sessionRegistry.update(sessionId, {
      sentenceBuffer: '',
      activeTurnId: null,
    });

    this.logger.log(`Interrupted session: ${sessionId}`);
  }

  // ── 断开清理 ──────────────────────────────────────────────────────────

  private async handleDisconnect(clientId: string) {
    this.clients.delete(clientId);
    const session = this.sessionRegistry.findByWsClientId(clientId);
    if (session) {
      await this.cleanupSession(session.sessionId);
    }
    this.logger.log(`Client disconnected: ${clientId}`);
  }

  private async cleanupSession(sessionId: string) {
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;
    session.abortController?.abort();
    this.sessionRegistry.delete(sessionId);
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────

  private send(client: WebSocket, msg: object) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
