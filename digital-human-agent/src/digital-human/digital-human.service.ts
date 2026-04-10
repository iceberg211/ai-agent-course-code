import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DigitalHumanService as IDigitalHumanService,
  DigitalHumanSessionOffer,
} from './digital-human.types';

interface SessionState {
  personaId: string;
  closed: boolean;
  listeners: Set<(candidate: RTCIceCandidateInit) => void>;
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
export class DigitalHumanService implements IDigitalHumanService {
  private readonly logger = new Logger(DigitalHumanService.name);
  private readonly sessions = new Map<string, SessionState>();

  async createSession(personaId: string): Promise<DigitalHumanSessionOffer> {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      personaId,
      closed: false,
      listeners: new Set(),
    });

    // 当前默认 mock 模式，不依赖外部数字人 SDK，保证链路可运行。
    // 接入真实厂商时，在此处返回真实 SDP Offer。
    this.logger.log(`数字人会话创建: session=${sessionId}, persona=${personaId}`);
    return {
      sessionId,
      sdpOffer: null,
    };
  }

  async setAnswer(
    sessionId: string,
    _sdpAnswer: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.ensureSession(sessionId);
  }

  async addIceCandidate(
    sessionId: string,
    _candidate: RTCIceCandidateInit,
  ): Promise<void> {
    this.ensureSession(sessionId);
  }

  onIceCandidate(
    sessionId: string,
    cb: (candidate: RTCIceCandidateInit) => void,
  ): () => void {
    const state = this.ensureSession(sessionId);
    state.listeners.add(cb);
    return () => {
      state.listeners.delete(cb);
    };
  }

  async speak(sessionId: string, turnId: string, text: string): Promise<void> {
    const state = this.ensureSession(sessionId);
    if (state.closed) return;
    // mock 模式只做轻量延时，模拟 SDK 消费文本时间。
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(Math.max(text.length * 8, 80), 480)),
    );
    this.logger.debug(
      `数字人播报片段: session=${sessionId}, turn=${turnId}, len=${text.length}`,
    );
  }

  async interrupt(sessionId: string, turnId?: string): Promise<void> {
    this.ensureSession(sessionId);
    this.logger.log(`数字人打断: session=${sessionId}, turn=${turnId ?? '-'}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.closed = true;
    state.listeners.clear();
    this.sessions.delete(sessionId);
    this.logger.log(`数字人会话关闭: session=${sessionId}`);
  }

  private ensureSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`数字人会话不存在: ${sessionId}`);
    }
    return state;
  }
}
