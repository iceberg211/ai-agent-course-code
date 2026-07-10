import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { TurnSideEffectService } from '@/conversation/services/turn-side-effect.service';
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
 * - Turn start 副作用经 TurnSideEffectService（落库 + 短期记忆）
 * - 委托 AgentPipelineService 执行 Agent
 */
/** 单次用户文本消息最大长度，超出则拒绝（防 LLM API 超额消费 / Token 超限）。*/
const MAX_USER_TEXT_LENGTH = 4000;

@Injectable()
export class TextHandler {
  constructor(
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly agentPipeline: AgentPipelineService,
    private readonly turnSideEffects: TurnSideEffectService,
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
