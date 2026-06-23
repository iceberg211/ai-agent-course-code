import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '@/conversation/services/conversation.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { AgentPipelineService } from '@/gateway/pipeline/agent-pipeline.service';
import { WsTextInputMessage } from '@/gateway/gateway.types';
import { sendJson } from '@/gateway/utils/ws-send.util';

/**
 * 处理文字输入消息（`conversation:text`）。
 *
 * 职责：
 * - 验证当前会话存在
 * - 验证文本非空且不超过长度上限（防滥用）
 * - 初始化 turn 状态（与 AudioHandler 共享相同逻辑，消除重复）
 * - 保存用户消息到 DB
 * - 委托 AgentPipelineService 执行 Agent
 */
/** 单次用户文本消息最大长度，超出则拒绝（防 LLM API 超额消费 / Token 超限）。*/
const MAX_USER_TEXT_LENGTH = 4000;

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
      sendJson(client, {
        type: 'error',
        sessionId: '',
        payload: { message: 'No active session' },
      });
      return;
    }

    const text = String(msg?.payload?.text ?? '').trim();
    if (!text) return;

    // 防滥用：拒绝超长消息，避免 LLM API 超额消费或 Token 超限
    if (text.length > MAX_USER_TEXT_LENGTH) {
      sendJson(client, {
        type: 'error',
        sessionId: session.sessionId,
        payload: { message: `消息过长，最多支持 ${MAX_USER_TEXT_LENGTH} 字符` },
      });
      return;
    }

    // 若已有进行中的 turn，先 abort 它再开新 turn，防止并发竞态
    if (
      session.activeTurnId &&
      session.abortController &&
      !session.abortController.signal.aborted
    ) {
      session.abortController.abort();
    }

    const turnId = randomUUID();
    this.sessionRegistry.initTurn(session.sessionId, turnId);

    await this.conversationService.addMessage({
      conversationId: session.conversationId,
      turnId,
      role: 'user',
      content: text,
      status: 'completed',
    });

    await this.agentPipeline.run(client, session, text, turnId);
  }
}
