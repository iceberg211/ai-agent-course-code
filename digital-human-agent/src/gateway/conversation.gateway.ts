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
import {
  RealtimeSession,
  SessionMode,
} from '../realtime-session/realtime-session.interface';
import { DigitalHumanService } from '../digital-human/digital-human.service';

interface TtsAudioFrameMeta {
  sessionId: string;
  turnId: string;
  seq: number;
  codec: 'audio/mpeg';
  isFinal?: boolean;
}

interface SessionHistoryMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'interrupted' | 'failed';
  createdAt: Date;
}

interface RTCSessionDescriptionInit {
  type: 'answer' | 'offer' | 'pranswer' | 'rollback';
  sdp?: string;
}

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

@Injectable()
@WebSocketGateway({ path: '/ws/conversation' })
export class ConversationGateway implements OnModuleInit {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(ConversationGateway.name);
  private readonly historyLimit = Math.min(
    Math.max(Number(process.env.SESSION_HISTORY_LIMIT ?? 80), 1),
    500,
  );
  // clientId → WebSocket
  private readonly clients = new Map<string, WebSocket>();

  constructor(
    private readonly agentService: AgentService,
    private readonly asrService: AsrService,
    private readonly ttsService: TtsService,
    private readonly digitalHumanService: DigitalHumanService,
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

      client.on('message', (data: Buffer, isBinary: boolean) => {
        void this.handleMessage(client, clientId, data, isBinary).catch((err) => {
          this.logger.error(
            `Handle message failed: ${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`,
          );
          this.send(client, {
            type: 'error',
            sessionId: '',
            payload: { message: '消息处理失败' },
          });
        });
      });

      client.on('close', (code: number, reason: Buffer) => {
        this.logger.log(
          `Client closing: ${clientId} code=${code} reason=${reason?.toString() ?? ''}`,
        );
        void this.cleanupClientById(clientId);
      });
    });
  }

  // ── 消息路由 ────────────────────────────────────────────────────────

  private async handleMessage(
    client: WebSocket,
    clientId: string,
    data: Buffer,
    isBinary: boolean,
  ) {
    // Binary：麦克风音频
    if (isBinary) {
      await this.handleAudio(client, clientId, data);
      return;
    }

    let msg: any;
    try {
      msg = JSON.parse(data.toString('utf-8'));
    } catch {
      this.send(client, { type: 'error', sessionId: '', payload: { message: 'Invalid JSON' } });
      return;
    }

    switch (msg.type) {
      case 'ping':
        this.send(client, {
          type: 'pong',
          sessionId: '',
          payload: { ts: Date.now() },
        });
        break;
      case 'session:start':
        await this.handleSessionStart(client, clientId, msg);
        break;
      case 'conversation:text':
        await this.handleTextInput(client, clientId, msg);
        break;
      case 'conversation:interrupt':
        await this.handleInterrupt(client, msg);
        break;
      case 'webrtc:answer':
        await this.handleWebRtcAnswer(client, msg);
        break;
      case 'webrtc:ice-candidate':
        await this.handleWebRtcIceCandidate(client, msg);
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
    const mode = this.parseSessionMode(msg?.payload?.mode);

    // 关闭旧会话（如果有）
    const oldSession = this.sessionRegistry.findByWsClientId(clientId);
    if (oldSession) {
      await this.cleanupSession(oldSession.sessionId);
    }

    // 复用该角色最近会话（用于历史对话恢复）
    await this.personaService.findOne(personaId); // 验证 persona 存在
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

    this.send(client, {
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
    this.sessionRegistry.update(session.sessionId, {
      activeTurnId: turnId,
      sentenceBuffer: '',
      abortController: null,
      ttsTurnId: turnId,
      ttsQueue: [],
      ttsProcessing: false,
      ttsSeq: 0,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      speakQueue: [],
      speakProcessing: false,
    });

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

  // ── 文字输入 ─────────────────────────────────────────────────────────

  private async handleTextInput(client: WebSocket, clientId: string, msg: any) {
    const session = this.sessionRegistry.findByWsClientId(clientId);
    if (!session) {
      this.send(client, {
        type: 'error',
        sessionId: '',
        payload: { message: 'No active session' },
      });
      return;
    }

    const text = String(msg?.payload?.text ?? '').trim();
    if (!text) return;

    const turnId = uuidv4();
    this.sessionRegistry.update(session.sessionId, {
      activeTurnId: turnId,
      sentenceBuffer: '',
      abortController: null,
      ttsTurnId: turnId,
      ttsQueue: [],
      ttsProcessing: false,
      ttsSeq: 0,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      speakQueue: [],
      speakProcessing: false,
    });

    await this.conversationService.addMessage({
      conversationId: session.conversationId,
      turnId,
      role: 'user',
      seq: 0,
      content: text,
      status: 'completed',
    });

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
          this.flushBuffer(client, session, turnId, token, false);
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
      this.flushBuffer(client, session, turnId, '', true);
      this.markTtsFinalize(client, session, turnId);

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
      this.markTtsFinalize(client, session, turnId);
      this.sessionRegistry.update(session.sessionId, {
        sentenceBuffer: '',
      });
    }
  }

  // ── 按句缓冲 ─────────────────────────────────────────────────────────

  private flushBuffer(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    token: string,
    isEnd: boolean,
  ) {
    if (session.ttsTurnId !== turnId) return;
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
      if (session.mode === 'digital-human') {
        this.enqueueSpeakSegment(client, session, turnId, text);
      } else {
        this.enqueueTtsSegment(client, session, turnId, text);
      }
    }
  }

  // ── TTS 推流 ─────────────────────────────────────────────────────────

  private enqueueTtsSegment(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    text: string,
  ) {
    if (!text.trim()) return;
    if (session.ttsTurnId !== turnId) return;

    session.ttsQueue.push(text);
    void this.drainTtsQueue(client, session, turnId);
  }

  private enqueueSpeakSegment(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    text: string,
  ) {
    if (!text.trim()) return;
    if (session.ttsTurnId !== turnId) return;
    if (session.mode !== 'digital-human') return;

    session.speakQueue.push({ turnId, text });
    void this.drainSpeakQueue(client, session, turnId);
  }

  private async drainTtsQueue(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ) {
    if (session.ttsProcessing) return;
    if (session.ttsTurnId !== turnId) return;

    session.ttsProcessing = true;

    if (!session.ttsStarted) {
      this.send(client, {
        type: 'tts:start',
        sessionId: session.sessionId,
        turnId,
        payload: { encoding: 'mp3' },
      });
      session.ttsStarted = true;
    }

    try {
      const persona = await this.personaService.findOne(session.personaId);
      const voiceId = persona.voiceId ?? null;

      while (session.ttsQueue.length > 0) {
        if (session.ttsTurnId !== turnId) break;

        const text = session.ttsQueue.shift();
        if (!text) continue;

        const signal =
          session.abortController?.signal ?? new AbortController().signal;

        await this.ttsService.synthesizeStream(
          text,
          voiceId,
          signal,
          (chunk: Buffer) => {
            if (session.ttsTurnId !== turnId) return;
            if (client.readyState !== WebSocket.OPEN) return;

            const meta: TtsAudioFrameMeta = {
              sessionId: session.sessionId,
              turnId,
              seq: session.ttsSeq++,
              codec: 'audio/mpeg',
            };
            client.send(this.wrapAudioFrame(meta, chunk));
          },
        );
      }
    } catch (err) {
      this.logger.error('TTS error', err);
      this.send(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'TTS failed' },
      });
    } finally {
      session.ttsProcessing = false;
      this.completeTtsTurnIfNeeded(client, session, turnId);
    }
  }

  private async drainSpeakQueue(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ) {
    if (session.mode !== 'digital-human') return;
    if (session.speakProcessing) return;
    if (session.ttsTurnId !== turnId) return;

    session.speakProcessing = true;
    if (!session.ttsStarted) {
      this.send(client, {
        type: 'digital-human:start',
        sessionId: session.sessionId,
        turnId,
      });
      session.ttsStarted = true;
    }

    try {
      while (session.speakQueue.length > 0) {
        if (session.ttsTurnId !== turnId) break;

        const item = session.speakQueue.shift();
        if (!item) continue;
        const digitalSessionId = session.digitalHumanSessionId;
        if (!digitalSessionId) break;

        this.send(client, {
          type: 'digital-human:subtitle',
          sessionId: session.sessionId,
          turnId,
          payload: { text: item.text },
        });

        await this.digitalHumanService.speak(
          digitalSessionId,
          turnId,
          item.text,
        );
      }
    } catch (err) {
      this.logger.error('Digital human speak error', err);
      this.send(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'Digital human speak failed' },
      });
    } finally {
      session.speakProcessing = false;
      this.completeTtsTurnIfNeeded(client, session, turnId);
    }
  }

  private markTtsFinalize(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ) {
    if (session.ttsTurnId !== turnId) return;
    session.ttsFinalizeRequested = true;
    this.completeTtsTurnIfNeeded(client, session, turnId);
  }

  private completeTtsTurnIfNeeded(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ) {
    if (session.ttsTurnId !== turnId) return;
    if (session.mode === 'digital-human') {
      if (session.speakProcessing) return;
      if (session.speakQueue.length > 0) return;
    } else {
      if (session.ttsProcessing) return;
      if (session.ttsQueue.length > 0) return;
    }
    if (!session.ttsFinalizeRequested) return;

    if (session.ttsStarted) {
      this.send(client, session.mode === 'voice'
        ? {
            type: 'tts:end',
            sessionId: session.sessionId,
            turnId,
          }
        : {
            type: 'digital-human:end',
            sessionId: session.sessionId,
            turnId,
          });
    }

    session.ttsTurnId = null;
    session.ttsStarted = false;
    session.ttsFinalizeRequested = false;
    session.ttsSeq = 0;
    session.speakQueue = [];
    session.speakProcessing = false;

    if (session.activeTurnId === turnId) {
      session.activeTurnId = null;
    }
    session.abortController = null;
  }

  private wrapAudioFrame(meta: TtsAudioFrameMeta, audioBytes: Buffer): Buffer {
    const metaBytes = Buffer.from(JSON.stringify(meta), 'utf-8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(metaBytes.length, 0);
    return Buffer.concat([head, metaBytes, audioBytes]);
  }

  // ── 打断 ──────────────────────────────────────────────────────────────

  private async handleInterrupt(client: WebSocket, msg: any) {
    const sessionId = msg?.sessionId as string;
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;

    const turnId = (msg?.turnId as string | undefined) ?? session.ttsTurnId;

    session.abortController?.abort();
    session.sentenceBuffer = '';
    session.activeTurnId = null;
    session.ttsQueue = [];
    session.speakQueue = [];
    session.ttsFinalizeRequested = true;

    if (session.mode === 'digital-human' && session.digitalHumanSessionId) {
      try {
        await this.digitalHumanService.interrupt(
          session.digitalHumanSessionId,
          turnId ?? undefined,
        );
      } catch (error) {
        this.logger.warn(
          `数字人打断失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (turnId) {
      this.completeTtsTurnIfNeeded(client, session, turnId);
    }

    this.send(client, {
      type: 'conversation:interrupted',
      sessionId,
      turnId: turnId ?? undefined,
      payload: { status: 'interrupted' },
    });

    this.logger.log(`Interrupted session: ${sessionId}`);
  }

  // ── WebRTC 信令 ───────────────────────────────────────────────────────

  private async handleWebRtcAnswer(client: WebSocket, msg: any) {
    const sessionId = String(msg?.sessionId ?? '');
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;
    if (session.mode !== 'digital-human' || !session.digitalHumanSessionId) {
      this.send(client, {
        type: 'error',
        sessionId,
        payload: { message: '当前会话不是数字人模式' },
      });
      return;
    }

    const sdpAnswer = msg?.payload?.sdpAnswer as RTCSessionDescriptionInit;
    if (!sdpAnswer?.type) return;

    await this.digitalHumanService.setAnswer(
      session.digitalHumanSessionId,
      sdpAnswer,
    );
  }

  private async handleWebRtcIceCandidate(client: WebSocket, msg: any) {
    const sessionId = String(msg?.sessionId ?? '');
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;
    if (session.mode !== 'digital-human' || !session.digitalHumanSessionId) {
      this.send(client, {
        type: 'error',
        sessionId,
        payload: { message: '当前会话不是数字人模式' },
      });
      return;
    }

    const candidate = msg?.payload?.candidate as RTCIceCandidateInit;
    if (!candidate || typeof candidate !== 'object') return;

    await this.digitalHumanService.addIceCandidate(
      session.digitalHumanSessionId,
      candidate,
    );
  }

  // ── 断开清理 ──────────────────────────────────────────────────────────

  private async cleanupClientById(clientId: string) {
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
    session.iceUnsubscribe?.();
    if (session.digitalHumanSessionId) {
      await this.digitalHumanService.closeSession(session.digitalHumanSessionId);
    }
    this.sessionRegistry.delete(sessionId);
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────

  private send(client: WebSocket, msg: object) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }

  private parseSessionMode(mode: unknown): SessionMode {
    return mode === 'digital-human' ? 'digital-human' : 'voice';
  }

  private async startDigitalHumanSession(
    client: WebSocket,
    sessionId: string,
    personaId: string,
  ) {
    const created = await this.digitalHumanService.createSession(personaId);
    const session = this.sessionRegistry.get(sessionId);
    if (!session) {
      await this.digitalHumanService.closeSession(created.sessionId);
      return;
    }

    const unsubscribe = this.digitalHumanService.onIceCandidate(
      created.sessionId,
      (candidate) => {
        this.send(client, {
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

    this.send(client, {
      type: 'webrtc:offer',
      sessionId,
      payload: {
        digitalSessionId: created.sessionId,
        sdpOffer: created.sdpOffer,
        mock: created.sdpOffer ? false : true,
      },
    });
  }
}
