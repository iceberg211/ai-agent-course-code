import { Injectable, Logger } from '@nestjs/common';
import { RealtimeSession } from './realtime-session.interface';

@Injectable()
export class RealtimeSessionRegistry {
  private readonly logger = new Logger(RealtimeSessionRegistry.name);
  private readonly sessions = new Map<string, RealtimeSession>();

  create(
    sessionId: string,
    params: Omit<RealtimeSession, 'sessionId'>,
  ): RealtimeSession {
    const session: RealtimeSession = { sessionId, ...params };
    this.sessions.set(sessionId, session);
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
    Object.assign(session, patch);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.logger.log(`Session deleted: ${sessionId}`);
  }

  getAll(): RealtimeSession[] {
    return Array.from(this.sessions.values());
  }

  findByWsClientId(wsClientId: string): RealtimeSession | undefined {
    return this.getAll().find((s) => s.wsClientId === wsClientId);
  }
}
