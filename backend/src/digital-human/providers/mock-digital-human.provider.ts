import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DigitalHumanHealthStatus,
  DigitalHumanProvider,
  DigitalHumanSessionInfo,
} from '@/digital-human/digital-human.types';

interface SessionState {
  personaId: string;
  closed: boolean;
}

@Injectable()
export class MockDigitalHumanProvider implements DigitalHumanProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockDigitalHumanProvider.name);
  private readonly sessions = new Map<string, SessionState>();

  async createSession(
    personaId: string,
    voiceId?: string,
  ): Promise<DigitalHumanSessionInfo> {
    const providerSessionId = randomUUID();
    this.sessions.set(providerSessionId, {
      personaId,
      closed: false,
    });
    this.logger.log(
      `创建 Mock 数字人会话: session=${providerSessionId}, persona=${personaId}, voice=${voiceId ?? '-'}`,
    );
    return {
      providerSessionId,
      speakMode: 'text-direct',
      credentials: {
        provider: this.name,
        mock: true,
      },
    };
  }

  async interrupt(providerSessionId: string, turnId?: string): Promise<void> {
    this.ensureSession(providerSessionId);
    this.logger.log(
      `Mock 数字人打断: session=${providerSessionId}, turn=${turnId ?? '-'}`,
    );
  }

  async closeSession(providerSessionId: string): Promise<void> {
    const state = this.sessions.get(providerSessionId);
    if (!state) return;
    state.closed = true;
    this.sessions.delete(providerSessionId);
    this.logger.log(`Mock 数字人会话关闭: session=${providerSessionId}`);
  }

  async speak(
    providerSessionId: string,
    turnId: string,
    text: string,
  ): Promise<void> {
    const state = this.ensureSession(providerSessionId);
    if (state.closed) return;
    // Mock 模式仅做轻量延时，模拟 Provider 消费文本。
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(Math.max(text.length * 8, 80), 480)),
    );
    this.logger.debug(
      `Mock 数字人播报: session=${providerSessionId}, turn=${turnId}, len=${text.length}`,
    );
  }

  async healthCheck(): Promise<DigitalHumanHealthStatus> {
    return { status: 'ok' };
  }

  private ensureSession(providerSessionId: string): SessionState {
    const state = this.sessions.get(providerSessionId);
    if (!state) {
      throw new Error(`Mock 数字人会话不存在: ${providerSessionId}`);
    }
    return state;
  }
}
