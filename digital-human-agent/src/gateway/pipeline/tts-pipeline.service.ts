import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { TtsService } from '@/tts/tts.service';
import { PersonaService } from '@/persona/persona.service';
import { RealtimeSessionRegistry } from '@/realtime-session/realtime-session.registry';
import { RealtimeSession } from '@/realtime-session/realtime-session.interface';
import { TtsAudioFrameMeta } from '@/gateway/gateway.types';

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

    session.ttsQueue.push(text);
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
    session.ttsFinalizeRequested = true;
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

    session.ttsProcessing = true;

    const outputFormat = this.getOutputFormat(session);
    const codec = outputFormat === 'pcm' ? 'audio/pcm' : 'audio/mpeg';

    // 发送 tts:start（仅第一次）
    if (!session.ttsStarted) {
      this.sendJson(client, {
        type: 'tts:start',
        sessionId: session.sessionId,
        turnId,
        payload: { encoding: outputFormat },
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
              codec,
            };
            client.send(this.wrapAudioFrame(meta, chunk));
          },
          outputFormat,
        );
      }
    } catch (err) {
      this.logger.error('TTS synthesize error', err);
      this.sendJson(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'TTS failed' },
      });
    } finally {
      session.ttsProcessing = false;
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
      this.sendJson(client, {
        type: 'tts:end',
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

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
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
