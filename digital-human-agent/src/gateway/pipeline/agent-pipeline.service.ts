import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { AgentService } from '../../agent/agent.service';
import { ConversationService } from '../../conversation/conversation.service';
import { RealtimeSessionRegistry } from '../../realtime-session/realtime-session.registry';
import { RealtimeSession } from '../../realtime-session/realtime-session.interface';
import { TtsPipelineService } from './tts-pipeline.service';
import { SpeakPipelineService } from './speak-pipeline.service';

/**
 * Agent 执行 Pipeline。
 *
 * 职责：
 * - 调用 AgentService.run()，接收 token 流
 * - 按句分割缓冲（中文句末符号 / 子句 / 长度溢出）
 * - 根据会话模式将句段分发给 TtsPipeline 或 SpeakPipeline
 * - Agent 完成后保存 assistant 消息并发送 `conversation:done`
 */
@Injectable()
export class AgentPipelineService {
  private readonly logger = new Logger(AgentPipelineService.name);

  /** 句末标点 → 立即刷出 */
  private static readonly SENTENCE_END = /[。？！；]/;
  /** 子句标点：缓冲超过阈值才刷出 */
  private static readonly CLAUSE_END = /[，、：]/;
  /** 子句触发最小长度 */
  private static readonly CLAUSE_MIN_LEN = 15;
  /** 强制刷出最大长度 */
  private static readonly BUFFER_MAX_LEN = 50;

  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly ttsPipeline: TtsPipelineService,
    private readonly speakPipeline: SpeakPipelineService,
  ) {}

  /**
   * 执行一次完整的 Agent 对话回合并驱动 TTS/播报。
   * 调用前，调用方应已完成 turn 状态初始化（activeTurnId 等）。
   */
  async run(
    client: WebSocket,
    session: RealtimeSession,
    userMessage: string,
    turnId: string,
  ): Promise<void> {
    const abortController = new AbortController();
    this.sessionRegistry.update(session.sessionId, { abortController });

    this.sendJson(client, {
      type: 'conversation:start',
      sessionId: session.sessionId,
      turnId,
    });

    let fullReply = '';

    try {
      await this.agentService.run({
        conversationId: session.conversationId,
        personaId: session.personaId,
        userMessage,
        turnId,
        signal: abortController.signal,
        onToken: (token: string) => {
          fullReply += token;

          // 推送文字 token 给前端
          this.sendJson(client, {
            type: 'conversation:text_chunk',
            sessionId: session.sessionId,
            turnId,
            payload: { token },
          });

          // 按句缓冲 → 分发到对应 Pipeline
          this.flushBuffer(client, session, turnId, token, false);
        },
        onCitations: (citations) => {
          this.sendJson(client, {
            type: 'conversation:citations',
            sessionId: session.sessionId,
            turnId,
            payload: { citations },
          });
        },
      });

      // 刷出剩余缓冲 & 标记结束
      this.flushBuffer(client, session, turnId, '', true);
      this.markFinalize(client, session, turnId);

      const status = abortController.signal.aborted ? 'interrupted' : 'completed';

      await this.conversationService.addMessage({
        conversationId: session.conversationId,
        turnId,
        role: 'assistant',
        seq: 0,
        content: fullReply,
        status,
      });

      this.sendJson(client, {
        type: 'conversation:done',
        sessionId: session.sessionId,
        turnId,
        payload: { status },
      });
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        this.logger.error('Agent run failed', err);
        this.sendJson(client, {
          type: 'error',
          sessionId: session.sessionId,
          payload: { message: 'Agent error' },
        });
      }
    } finally {
      // 确保无论如何都完成 TTS turn（防止前端等待）
      this.markFinalize(client, session, turnId);
      this.sessionRegistry.update(session.sessionId, { sentenceBuffer: '' });
    }
  }

  // ── 按句缓冲 ───────────────────────────────────────────────────────────────

  private flushBuffer(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    token: string,
    isEnd: boolean,
  ): void {
    if (session.ttsTurnId !== turnId) return;
    session.sentenceBuffer += token;

    const shouldFlush =
      AgentPipelineService.SENTENCE_END.test(token) ||
      (AgentPipelineService.CLAUSE_END.test(token) &&
        session.sentenceBuffer.length > AgentPipelineService.CLAUSE_MIN_LEN) ||
      session.sentenceBuffer.length > AgentPipelineService.BUFFER_MAX_LEN ||
      isEnd;

    if (shouldFlush && session.sentenceBuffer.trim()) {
      const text = session.sentenceBuffer.trim();
      session.sentenceBuffer = '';

      if (
        session.mode === 'digital-human' &&
        session.digitalHumanSpeakMode === 'text-direct'
      ) {
        this.speakPipeline.enqueue(client, session, turnId, text);
      } else {
        this.ttsPipeline.enqueue(client, session, turnId, text);
      }
    }
  }

  private markFinalize(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
  ): void {
    if (
      session.mode === 'digital-human' &&
      session.digitalHumanSpeakMode === 'text-direct'
    ) {
      this.speakPipeline.markFinalize(client, session, turnId);
    } else {
      this.ttsPipeline.markFinalize(client, session, turnId);
    }
  }

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
