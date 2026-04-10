import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { DigitalHumanService } from '../../digital-human/digital-human.service';
import { RealtimeSession } from '../../realtime-session/realtime-session.interface';

/**
 * 数字人播报 Pipeline。
 *
 * 职责：
 * - 维护 speakQueue 的串行消费（避免并发播报乱序）
 * - 调用 DigitalHumanService.speak() 驱动数字人说话
 * - 推送 `digital-human:subtitle` 字幕和 `digital-human:end` 事件
 */
@Injectable()
export class SpeakPipelineService {
  private readonly logger = new Logger(SpeakPipelineService.name);

  constructor(
    private readonly digitalHumanService: DigitalHumanService,
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

    session.speakQueue.push({ turnId, text });
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
    session.ttsFinalizeRequested = true;
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
    if (session.speakProcessing) return;
    if (session.ttsTurnId !== turnId) return;

    session.speakProcessing = true;

    // 发送 digital-human:start（仅第一次）
    if (!session.ttsStarted) {
      this.sendJson(client, {
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

        this.sendJson(client, {
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
      this.sendJson(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'Digital human speak failed' },
      });
    } finally {
      session.speakProcessing = false;
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
      this.sendJson(client, {
        type: 'digital-human:end',
        sessionId: session.sessionId,
        turnId,
      });
    }

    this.resetTurnState(session, turnId);
  }

  private resetTurnState(session: RealtimeSession, turnId: string): void {
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

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
