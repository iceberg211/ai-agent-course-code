import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConversationService } from '../../conversation/conversation.service';
import { RealtimeSessionRegistry } from '../../realtime-session/realtime-session.registry';
import { AgentPipelineService } from '../pipeline/agent-pipeline.service';
import { WsTextInputMessage } from '../gateway.types';

/**
 * 处理文字输入消息（`conversation:text`）。
 *
 * 职责：
 * - 验证当前会话存在
 * - 验证文本非空
 * - 初始化 turn 状态（与 AudioHandler 共享相同逻辑，消除重复）
 * - 保存用户消息到 DB
 * - 委托 AgentPipelineService 执行 Agent
 */
@Injectable()
export class TextHandler {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly agentPipeline: AgentPipelineService,
  ) {}

  async handle(
    client: WebSocket,
    clientId: string,
    msg: WsTextInputMessage,
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

    const text = String(msg?.payload?.text ?? '').trim();
    if (!text) return;

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
