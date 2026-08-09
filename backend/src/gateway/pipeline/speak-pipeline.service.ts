import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { DIGITAL_HUMAN_PROVIDER } from '@/common/constants';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { RealtimeSession } from '@/conversation/interfaces/realtime-session.interface';
import { sendJson } from '@/gateway/utils/ws-send.util';


/**
 * 数字人播报 Pipeline。
 *
 * 职责：
 * - 维护 speakQueue 的串行消费（避免并发播报乱序）
 * - 调用 DigitalHumanProvider.speak() 驱动数字人说话
 * - 推送 `digital-human:subtitle` 字幕和 `digital-human:end` 事件
 */
@Injectable()
export class SpeakPipelineService {
  private readonly logger = new Logger(SpeakPipelineService.name);

  constructor(
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
    private readonly sessionRegistry: RealtimeSessionRegistry,
  ) {}

  /**
   * 将一个播报片段加入队列，并触发消费。
   */
  enqueue(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    text: string,
  ): void {
    if (!text.trim()) return;
    if (session.ttsTurnId !== turnId) return;
    if (session.mode !== 'digital-human') return;
    if (session.digitalHumanSpeakMode !== 'text-direct') return;

    this.sessionRegistry.pushSpeakQueue(session.sessionId, { turnId, text });
    void this.drain(client, session, turnId);
  }

  /**
   * 通知已产出所有文字，等队列消费完后发送 `digital-human:end`。
   */
  markFinalize(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): void {
    if (session.ttsTurnId !== turnId) return;
    if (session.digitalHumanSpeakMode !== 'text-direct') return;
    this.sessionRegistry.update(session.sessionId, { ttsFinalizeRequested: true });
    this.completeTurnIfNeeded(client, session, turnId);
  }

  /**
   * 串行消费播报队列。
   */
  private async drain(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): Promise<void> {
    if (session.mode !== 'digital-human') return;
    if (session.digitalHumanSpeakMode !== 'text-direct') return;
    if (session.speakProcessing) return;
    if (session.ttsTurnId !== turnId) return;

    this.sessionRegistry.update(session.sessionId, { speakProcessing: true });

    // 发送 digital-human:start（仅第一次）
    if (!session.ttsStarted) {
      sendJson(client, {
        type: 'digital-human:start',
        sessionId: session.sessionId,
        turnId,
      });
      this.sessionRegistry.update(session.sessionId, { ttsStarted: true });
    }

    try {
      while (session.speakQueue.length > 0) {
        if (session.ttsTurnId !== turnId) break;

        const item = this.sessionRegistry.shiftSpeakQueue(session.sessionId);
        if (!item) continue;

        const digitalSessionId = session.digitalHumanSessionId;
        if (!digitalSessionId) break;

        if (!this.digitalHumanProvider.speak) {
          this.logger.warn(
            `当前数字人 Provider ${this.digitalHumanProvider.name} 不支持 speak 文本播报能力`,
          );
          break;
        }

        sendJson(client, {
          type: 'digital-human:subtitle',
          sessionId: session.sessionId,
          turnId,
          payload: { text: item.text },
        });

        await this.digitalHumanProvider.speak(
          digitalSessionId,
          turnId,
          item.text,
        );
      }
    } catch (err) {
      this.logger.error('Digital human speak error', err);
      sendJson(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'Digital human speak failed' },
      });
    } finally {
      this.sessionRegistry.update(session.sessionId, { speakProcessing: false });
      this.completeTurnIfNeeded(client, session, turnId);
    }
  }

  /**
   * 若队列已空且已标记结束，发送 `digital-human:end` 并重置 turn 状态。
   */
  completeTurnIfNeeded(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): void {
    if (session.ttsTurnId !== turnId) return;
    if (session.speakProcessing) return;
    if (session.speakQueue.length > 0) return;
    if (!session.ttsFinalizeRequested) return;

    if (session.ttsStarted) {
      sendJson(client, {
        type: 'digital-human:end',
        sessionId: session.sessionId,
        turnId,
      });
    }

    this.resetTurnState(session, turnId);
  }

  private resetTurnState(session: RealtimeSession, turnId: string): void {
    this.sessionRegistry.clearSpeakQueue(session.sessionId);
    this.sessionRegistry.update(session.sessionId, {
      ttsTurnId: null,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      ttsSeq: 0,
      speakProcessing: false,
      activeTurnId: session.activeTurnId === turnId ? null : session.activeTurnId,
      abortController: null,
    });
  }

}

