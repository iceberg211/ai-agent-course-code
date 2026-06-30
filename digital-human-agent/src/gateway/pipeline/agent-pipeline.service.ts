import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { AgentService } from '@/agent/agent.service';
import type { RagWorkflowResult } from '@/agent/types/rag-workflow.types';
import { ConversationService } from '@/conversation/services/conversation.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { RealtimeSession } from '@/conversation/interfaces/realtime-session.interface';
import { TtsPipelineService } from '@/gateway/pipeline/tts-pipeline.service';
import { SpeakPipelineService } from '@/gateway/pipeline/speak-pipeline.service';
import { sendJson } from '@/gateway/utils/ws-send.util';

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

    sendJson(client, {
      type: 'conversation:start',
      sessionId: session.sessionId,
      turnId,
    });

    let fullReply = '';
    let status: 'completed' | 'interrupted' | 'failed' = 'completed';
    let shouldSendError = false;
    let citations: unknown[] = [];
    let ragTrace: Record<string, unknown> | null = null;
    const startedAt = Date.now();

    try {
      const result = await this.agentService.run({
        conversationId: session.conversationId,
        personaId: session.personaId,
        userMessage,
        turnId,
        signal: abortController.signal,
        accessScope: session.accessScope ?? {
          ownerId: session.ownerId,
          department: session.department ?? null,
          role: session.role ?? null,
        },
        onToken: (token: string) => {
          fullReply += token;

          // 推送文字 token 给前端
          sendJson(client, {
            type: 'conversation:text_chunk',
            sessionId: session.sessionId,
            turnId,
            payload: { token },
          });

          // 按句缓冲 → 分发到对应 Pipeline
          this.flushBuffer(client, session, turnId, token, false);
        },
        onCitations: (items) => {
          citations = items;
          sendJson(client, {
            type: 'conversation:citations',
            sessionId: session.sessionId,
            turnId,
            payload: { citations: items },
          });
        },
      });
      ragTrace = this.toRagTrace(result);
      status = abortController.signal.aborted ? 'interrupted' : 'completed';
    } catch (err: unknown) {
      const isAbortError = (err as { name?: string })?.name === 'AbortError';
      status =
        abortController.signal.aborted || isAbortError
          ? 'interrupted'
          : 'failed';
      if (!isAbortError) {
        shouldSendError = true;
        this.logger.error('Agent run failed', err);
      }
    } finally {
      this.flushBuffer(client, session, turnId, '', true);

      // 确保无论如何都完成 TTS turn（防止前端等待）
      this.markFinalize(client, session, turnId);
      this.sessionRegistry.update(session.sessionId, { sentenceBuffer: '' });

      const isInterrupted = status === 'interrupted';
      const hasWrittenReply = fullReply.trim().length > 0;

      // 只有在未被打断，或者被打断但确实生成了部分有效文本时，才写入数据库，防止空数据污染
      if (!isInterrupted || hasWrittenReply) {
        await this.conversationService.addMessage({
          conversationId: session.conversationId,
          turnId,
          role: 'assistant',
          content: fullReply,
          status,
          citations,
          ragTrace,
          latencyMs: Date.now() - startedAt,
        });
      }

      if (shouldSendError) {
        sendJson(client, {
          type: 'error',
          sessionId: session.sessionId,
          payload: { message: 'Agent error' },
        });
      }

      // 如果是被打断，由 InterruptHandler 负责通知 conversation:interrupted
      // 避免在此处重复发送 done 导致前端接收事件冲突和状态闪烁
      if (!isInterrupted) {
        sendJson(client, {
          type: 'conversation:done',
          sessionId: session.sessionId,
          turnId,
          payload: { status },
        });
      }
    }
  }

  private toRagTrace(result: RagWorkflowResult): Record<string, unknown> {
    const state = result.state;
    return {
      strategy: state.strategy,
      routeReason: state.routeReason,
      retrievalStrategy: state.retrievalStrategy,
      retrievalStrategyReason: state.retrievalStrategyReason,
      subQuestions: state.subQuestions,
      retrievalHistory: state.retrievalHistory,
      retrievalTrace: state.retrievalTrace,
      enough: state.enough,
      missingFacts: state.missingFacts,
      evaluationReason: state.evaluationReason,
      webSearchUsed: state.webSearchUsed,
      webSearchQueries: state.webSearchQueries,
      stopReason: state.stopReason,
      orchestrator: state.orchestrator,
    };
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
    this.sessionRegistry.appendToSentenceBuffer(session.sessionId, token);

    while (true) {
      const buffer = session.sentenceBuffer;
      if (!buffer.trim()) {
        this.sessionRegistry.update(session.sessionId, { sentenceBuffer: '' });
        break;
      }

      let splitIndex = -1;

      // 1. 优先寻找最靠近前面的句末标点 (。？！；)
      const sentenceEndMatch = /[。？！；]/.exec(buffer);
      if (sentenceEndMatch) {
        splitIndex = sentenceEndMatch.index + 1;
      } else {
        // 2. 如果没有句末标点，从前往后寻找满足最小长度限制的第一个子句标点 (，、：)
        const clauseRegex = /[，、：]/g;
        let match: RegExpExecArray | null;
        while ((match = clauseRegex.exec(buffer)) !== null) {
          if (match.index + 1 >= AgentPipelineService.CLAUSE_MIN_LEN) {
            splitIndex = match.index + 1;
            break;
          }
        }

        // 3. 如果依然没有找到，且字数已经达到 BUFFER_MAX_LEN 强制切断，避免过大延迟
        if (splitIndex === -1 && buffer.length >= AgentPipelineService.BUFFER_MAX_LEN) {
          splitIndex = AgentPipelineService.BUFFER_MAX_LEN;
        }
      }

      // 如果找到了断句位置，进行切割
      if (splitIndex !== -1) {
        const text = buffer.slice(0, splitIndex).trim();
        this.sessionRegistry.update(session.sessionId, { sentenceBuffer: buffer.slice(splitIndex) });

        if (text) {
          this.sendToPipeline(client, session, turnId, text);
        }
        // 继续循环处理剩下可能满足条件的句子
        continue;
      }

      // 4. 如果是流结束，把剩余的部分全部刷出去
      if (isEnd && session.sentenceBuffer.trim()) {
        const text = session.sentenceBuffer.trim();
        this.sessionRegistry.update(session.sessionId, { sentenceBuffer: '' });
        this.sendToPipeline(client, session, turnId, text);
      }

      break;
    }
  }

  private sendToPipeline(
    client: WebSocket,
    session: RealtimeSession,
    turnId: string,
    text: string,
  ): void {
    if (
      session.mode === 'digital-human' &&
      session.digitalHumanSpeakMode === 'text-direct'
    ) {
      this.speakPipeline.enqueue(client, session, turnId, text);
    } else {
      this.ttsPipeline.enqueue(client, session, turnId, text);
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
}
