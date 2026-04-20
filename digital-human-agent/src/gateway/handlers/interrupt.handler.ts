import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { DIGITAL_HUMAN_PROVIDER } from '@/digital-human/digital-human.constants';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { RealtimeSessionRegistry } from '@/realtime-session/realtime-session.registry';
import { TtsPipelineService } from '@/gateway/pipeline/tts-pipeline.service';
import { SpeakPipelineService } from '@/gateway/pipeline/speak-pipeline.service';
import { WsInterruptMessage } from '@/gateway/gateway.types';

/**
 * 处理 `conversation:interrupt` 消息。
 *
 * 职责：
 * - Abort 正在进行的 Agent
 * - 清空 TTS/Speak 队列
 * - 通知数字人侧打断
 * - 触发 Pipeline 完成当前 turn（发送结束事件）
 * - 发送 `conversation:interrupted`
 */
@Injectable()
export class InterruptHandler {
  private readonly logger = new Logger(InterruptHandler.name);

  constructor(
    private readonly sessionRegistry: RealtimeSessionRegistry,
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
    private readonly ttsPipeline: TtsPipelineService,
    private readonly speakPipeline: SpeakPipelineService,
  ) {}

  async handle(client: WebSocket, msg: WsInterruptMessage): Promise<void> {
    const sessionId = msg?.sessionId ?? '';
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;

    const turnId = (msg?.turnId) ?? session.ttsTurnId ?? undefined;

    // 中止 Agent
    session.abortController?.abort();
    session.sentenceBuffer = '';
    session.activeTurnId = null;
    session.ttsQueue = [];
    session.speakQueue = [];
    session.ttsFinalizeRequested = true;

    // 通知数字人打断
    if (session.mode === 'digital-human' && session.digitalHumanSessionId) {
      try {
        await this.digitalHumanProvider.interrupt(
          session.digitalHumanSessionId,
          turnId,
        );
      } catch (error) {
        this.logger.warn(
          `数字人打断失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 触发 Pipeline 完成当前 turn
    if (turnId) {
      if (
        session.mode === 'digital-human' &&
        session.digitalHumanSpeakMode === 'text-direct'
      ) {
        this.speakPipeline.completeTurnIfNeeded(client, session, turnId);
      } else {
        this.ttsPipeline.completeTurnIfNeeded(client, session, turnId);
      }
    }

    this.sendJson(client, {
      type: 'conversation:interrupted',
      sessionId,
      turnId,
      payload: { status: 'interrupted' },
    });

    this.logger.log(`Interrupted session: ${sessionId}`);
  }

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
