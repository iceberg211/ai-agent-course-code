import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { AsrService } from '@/speech/asr/asr.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { TurnSideEffectService } from '@/conversation/services/turn-side-effect.service';
import { AgentPipelineService } from '@/gateway/pipeline/agent-pipeline.service';
import { sendJson } from '@/gateway/utils/ws-send.util';

/**
 * 处理二进制音频帧（麦克风录音 → ASR → Agent）。
 *
 * 职责：
 * - 验证当前会话存在
 * - 调用 AsrService 识别语音
 * - Turn start 副作用经 TurnSideEffectService（落库 + 短期记忆）
 * - 初始化 turn 状态
 * - 委托 AgentPipelineService 执行 Agent
 */
@Injectable()
export class AudioHandler {
  constructor(
    private readonly asrService: AsrService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly agentPipeline: AgentPipelineService,
    private readonly turnSideEffects: TurnSideEffectService,
  ) {}

  async handle(
    client: WebSocket,
    clientId: string,
    audio: Buffer,
  ): Promise<void> {
    const session = this.sessionRegistry.findByWsClientId(clientId);
    if (!session) {
      sendJson(client, {
        type: 'error',
        sessionId: '',
        payload: { message: 'No active session' },
      });
      return;
    }

    let text: string;
    try {
      text = await this.asrService.recognize(audio);
    } catch {
      sendJson(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'ASR failed' },
      });
      return;
    }

    if (!text.trim()) return;

    // 推送 ASR 识别结果
    sendJson(client, {
      type: 'asr:final',
      sessionId: session.sessionId,
      payload: { text },
    });

    // 若已有进行中的 turn，先 abort 它再开新 turn，防止并发竞态
    if (
      session.activeTurnId &&
      session.abortController &&
      !session.abortController.signal.aborted
    ) {
      session.abortController.abort();
    }

    const turnId = randomUUID();
    const startedAt = Date.now();
    this.sessionRegistry.initTurn(session.sessionId, turnId);

    const sideEffectFlags = await this.turnSideEffects.onTurnStart({
      conversationId: session.conversationId,
      turnId,
      userMessage: text,
    });

    await this.agentPipeline.run(client, session, text, turnId, {
      sideEffectFlags,
      startedAt,
    });
  }
}
