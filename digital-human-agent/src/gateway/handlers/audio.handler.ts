import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { AsrService } from '../../asr/asr.service';
import { ConversationService } from '../../conversation/conversation.service';
import { RealtimeSessionRegistry } from '../../realtime-session/realtime-session.registry';
import { AgentPipelineService } from '../pipeline/agent-pipeline.service';

/**
 * 处理二进制音频帧（麦克风录音 → ASR → Agent）。
 *
 * 职责：
 * - 验证当前会话存在
 * - 调用 AsrService 识别语音
 * - 保存用户消息到 DB
 * - 初始化 turn 状态
 * - 委托 AgentPipelineService 执行 Agent
 */
@Injectable()
export class AudioHandler {
  constructor(
    private readonly asrService: AsrService,
    private readonly conversationService: ConversationService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly agentPipeline: AgentPipelineService,
  ) {}

  async handle(
    client: WebSocket,
    clientId: string,
    audio: Buffer,
  ): Promise<void> {
    const session = this.sessionRegistry.findByWsClientId(clientId);
    if (!session) {
      this.sendJson(client, {
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
      this.sendJson(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: 'ASR failed' },
      });
      return;
    }

    if (!text.trim()) return;

    // 推送 ASR 识别结果
    this.sendJson(client, {
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

    const turnId = uuidv4();
    this.sessionRegistry.update(session.sessionId, {
      activeTurnId: turnId,
      sentenceBuffer: '',
      abortController: null,
      ttsTurnId: turnId,
      ttsQueue: [],
      ttsProcessing: false,
      ttsSeq: 0,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      speakQueue: [],
      speakProcessing: false,
    });

    await this.conversationService.addMessage({
      conversationId: session.conversationId,
      turnId,
      role: 'user',
      seq: 0,
      content: text,
      status: 'completed',
    });

    await this.agentPipeline.run(client, session, text, turnId);
  }

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
