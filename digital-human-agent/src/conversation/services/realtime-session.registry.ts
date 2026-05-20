import { Injectable, Logger } from '@nestjs/common';
import { RealtimeSession } from '@/conversation/interfaces/realtime-session.interface';

@Injectable()
export class RealtimeSessionRegistry {
  private readonly logger = new Logger(RealtimeSessionRegistry.name);
  private readonly sessions = new Map<string, RealtimeSession>();
  /** 反向索引 Map: wsClientId -> sessionId */
  private readonly wsClientIndex = new Map<string, string>();

  create(
    sessionId: string,
    params: Omit<RealtimeSession, 'sessionId'>,
  ): RealtimeSession {
    const session: RealtimeSession = { sessionId, ...params };
    this.sessions.set(sessionId, session);
    if (params.wsClientId) {
      this.wsClientIndex.set(params.wsClientId, sessionId);
    }
    this.logger.log(`Session created: ${sessionId}`);
    return session;
  }

  get(sessionId: string): RealtimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  update(
    sessionId: string,
    patch: Partial<Omit<RealtimeSession, 'sessionId'>>,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // 如果 wsClientId 被更新，同步更新反向索引
    if (patch.wsClientId !== undefined) {
      if (session.wsClientId) {
        this.wsClientIndex.delete(session.wsClientId);
      }
      if (patch.wsClientId) {
        this.wsClientIndex.set(patch.wsClientId, sessionId);
      }
    }

    Object.assign(session, patch);
  }

  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.wsClientId) {
      this.wsClientIndex.delete(session.wsClientId);
    }
    this.sessions.delete(sessionId);
    this.logger.log(`Session deleted: ${sessionId}`);
  }

  getAll(): RealtimeSession[] {
    return Array.from(this.sessions.values());
  }

  findByWsClientId(wsClientId: string): RealtimeSession | undefined {
    const sessionId = this.wsClientIndex.get(wsClientId);
    return sessionId ? this.get(sessionId) : undefined;
  }

  /**
   * 初始化新一轮 Turn 的状态字段。
   * 消除 AudioHandler 和 TextHandler 重复的初始化模板。
   */
  initTurn(sessionId: string, turnId: string): void {
    this.update(sessionId, {
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
  }
}

