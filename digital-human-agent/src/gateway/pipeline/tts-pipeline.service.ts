import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { TtsService } from '@/speech/tts/tts.service';
import { PersonaService } from '@/persona/persona.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { RealtimeSession } from '@/conversation/interfaces/realtime-session.interface';
import { TtsAudioFrameMeta } from '@/gateway/gateway.types';
import { sendJson } from '@/gateway/utils/ws-send.util';


/**
 * TTS 推流 Pipeline。
 *
 * 职责：
 * - 维护带并发控制的 TTS 句段队列（每个 turn 串行合成）
 * - 将音频帧以二进制帧格式推送给前端
 * - 在 Agent 侧标记结束后，等队列清空再发送 `tts:end`
 *
 * 所有方法操作 `RealtimeSession` 上的 tts* 字段，由调用方持有 session 引用。
 */
@Injectable()
export class TtsPipelineService {
  private readonly logger = new Logger(TtsPipelineService.name);

  constructor(
    private readonly ttsService: TtsService,
    private readonly personaService: PersonaService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
  ) {}

  /**
   * 将一个句段加入队列，并触发消费。
   */
  enqueue(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    text: string,
  ): void {
    if (!text.trim()) return;
    if (session.ttsTurnId !== turnId) return;

    this.sessionRegistry.pushTtsQueue(session.sessionId, text);
    void this.drain(client, session, turnId);
  }

  /**
   * 通知 Agent 侧已产出所有文字，等 TTS 队列消费完后发送 `tts:end`。
   */
  markFinalize(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): void {
    if (session.ttsTurnId !== turnId) return;
    this.sessionRegistry.update(session.sessionId, { ttsFinalizeRequested: true });
    this.completeTurnIfNeeded(client, session, turnId);
  }

  /**
   * 串行消费 tts 队列。
   */
  private async drain(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): Promise<void> {
    if (session.ttsProcessing) return;
    if (session.ttsTurnId !== turnId) return;

    this.sessionRegistry.update(session.sessionId, { ttsProcessing: true });

    const outputFormat = this.getOutputFormat(session);
    const codec = outputFormat === 'pcm' ? 'audio/pcm' : 'audio/mpeg';

    // 发送 tts:start（仅第一次）
    if (!session.ttsStarted) {
      sendJson(client, {
        type: 'tts:start',
        sessionId: session.sessionId,
        turnId,
        payload: { encoding: outputFormat },
      });
      this.sessionRegistry.update(session.sessionId, { ttsStarted: true });
    }

    try {
      // 优化性能：直接使用缓存的 voiceId，不再每次访问数据库
      const voiceId = session.voiceId;

      while (session.ttsQueue.length > 0) {
        if (session.ttsTurnId !== turnId) break;

        const text = this.sessionRegistry.shiftTtsQueue(session.sessionId);
        if (!text) continue;

        let signal = session.abortController?.signal;
        if (!signal) {
          const controller = new AbortController();
          this.sessionRegistry.update(session.sessionId, { abortController: controller });
          signal = controller.signal;
        }

        await this.ttsService.synthesizeStream(
          text,
          voiceId,
          signal,
          (chunk: Buffer) => {
            if (session.ttsTurnId !== turnId) return;
            if (client.readyState !== WebSocket.OPEN) return;

            const currentSeq = session.ttsSeq;
            this.sessionRegistry.update(session.sessionId, { ttsSeq: currentSeq + 1 });

            const meta: TtsAudioFrameMeta = {
              sessionId: session.sessionId,
              turnId,
              seq: currentSeq,
              codec,
            };
            client.send(this.wrapAudioFrame(meta, chunk));
          },
          outputFormat,
        );
      }
    } catch (err) {
      this.sessionRegistry.clearTtsQueue(session.sessionId);
      if ((err as { name?: string })?.name !== 'AbortError') {
        this.logger.error('TTS synthesize error', err);
        sendJson(client, {
          type: 'error',
          sessionId: session.sessionId,
          payload: { message: 'TTS failed' },
        });
      }
    } finally {
      this.sessionRegistry.update(session.sessionId, { ttsProcessing: false });
      this.completeTurnIfNeeded(client, session, turnId);
    }
  }

  /**
   * 若队列已空且已标记结束，发送 `tts:end` 并重置 turn 状态。
   */
  completeTurnIfNeeded(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): void {
    if (session.ttsTurnId !== turnId) return;
    if (session.ttsProcessing) return;
    if (session.ttsQueue.length > 0) return;
    if (!session.ttsFinalizeRequested) return;

    if (session.ttsStarted) {
      sendJson(client, {
        type: 'tts:end',
        sessionId: session.sessionId,
        turnId,
      });
    }

    this.resetTurnState(session, turnId);
  }

  private resetTurnState(session: RealtimeSession, turnId: string): void {
    this.sessionRegistry.update(session.sessionId, {
      ttsTurnId: null,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      ttsSeq: 0,
      activeTurnId: session.activeTurnId === turnId ? null : session.activeTurnId,
      abortController: null,
    });
  }

  private wrapAudioFrame(meta: TtsAudioFrameMeta, audioBytes: Buffer): Buffer {
    const metaBytes = Buffer.from(JSON.stringify(meta), 'utf-8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(metaBytes.length, 0);
    return Buffer.concat([head, metaBytes, audioBytes]);
  }
  private getOutputFormat(session: RealtimeSession): 'mp3' | 'pcm' {
    if (
      session.mode === 'digital-human' &&
      session.digitalHumanSpeakMode === 'pcm-stream'
    ) {
      return 'pcm';
    }
    return 'mp3';
  }
}

