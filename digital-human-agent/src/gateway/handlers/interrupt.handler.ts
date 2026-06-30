import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { DIGITAL_HUMAN_PROVIDER } from '@/common/constants';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { TtsPipelineService } from '@/gateway/pipeline/tts-pipeline.service';
import { SpeakPipelineService } from '@/gateway/pipeline/speak-pipeline.service';
import { WsInterruptMessage } from '@/gateway/gateway.types';
import { sendJson } from '@/gateway/utils/ws-send.util';


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

    const turnId = msg?.turnId ?? session.ttsTurnId ?? undefined;

    // 1. 中止 Agent 计算
    session.abortController?.abort();
    this.sessionRegistry.clearTtsQueue(session.sessionId);
    this.sessionRegistry.clearSpeakQueue(session.sessionId);

    // 2. 如果已经开始播报/推流，主动推送结束消息以同步前端 UI 状态，不要等待未定的异步 finally
    if (session.ttsStarted && turnId) {
      const endType =
        session.mode === 'digital-human' &&
        session.digitalHumanSpeakMode === 'text-direct'
          ? 'digital-human:end'
          : 'tts:end';
      sendJson(client, {
        type: endType,
        sessionId,
        turnId,
      });
    }

    // 3. 强制同步复位状态，消除由于异步 finally 中 completeTurnIfNeeded 拦截及后续 turnId 覆盖引起的状态遗留风险
    this.sessionRegistry.update(session.sessionId, {
      sentenceBuffer: '',
      activeTurnId: null,
      ttsTurnId: null,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      ttsSeq: 0,
      ttsProcessing: false,
      speakProcessing: false,
      abortController: null,
    });

    // 4. 通知数字人打断
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

    sendJson(client, {
      type: 'conversation:interrupted',
      sessionId,
      turnId,
      payload: { status: 'interrupted' },
    });

    this.logger.log(`Interrupted session: ${sessionId}`);
  }
}

