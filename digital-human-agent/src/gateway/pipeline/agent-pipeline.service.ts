import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { AgentService } from '@/agent/agent.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { RealtimeSession } from '@/conversation/interfaces/realtime-session.interface';
import { TtsPipelineService } from '@/gateway/pipeline/tts-pipeline.service';
import { SpeakPipelineService } from '@/gateway/pipeline/speak-pipeline.service';
import { sendJson } from '@/gateway/utils/ws-send.util';
import { resolveRealtimeProfileId } from '@/common/rag/rag-profile';
import { TurnSideEffectService } from '@/conversation/services/turn-side-effect.service';

/**
 * Agent 执行 Pipeline。
 *
 * 职责：
 * - 调用 AgentService.run()，接收 token 流
 * - 按句分割缓冲 → TTS / Speak
 * - Turn 副作用委托 TurnSideEffectService
 */
@Injectable()
export class AgentPipelineService {
  private readonly logger = new Logger(AgentPipelineService.name);

  private static readonly SENTENCE_END = /[。？！；]/;
  private static readonly CLAUSE_END = /[，、：]/;
  private static readonly CLAUSE_MIN_LEN = 15;
  private static readonly BUFFER_MAX_LEN = 50;

  constructor(
    private readonly agentService: AgentService,
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly ttsPipeline: TtsPipelineService,
    private readonly speakPipeline: SpeakPipelineService,
    private readonly turnSideEffects: TurnSideEffectService,
  ) {}

  async run(
    client: WebSocket,
    session: RealtimeSession,
    userMessage: string,
    turnId: string,
    options?: { sideEffectFlags?: string[]; startedAt?: number },
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
    const startedAt = options?.startedAt ?? Date.now();
    const profileId = resolveRealtimeProfileId(session.mode);

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
        profileId,
        startedAt,
        onToken: (token: string) => {
          fullReply += token;
          sendJson(client, {
            type: 'conversation:text_chunk',
            sessionId: session.sessionId,
            turnId,
            payload: { token },
          });
          this.flushBuffer(client, session, turnId, token, false);
        },
        onCitations: (items) => {
          // Turn protocol: evidence ready
          citations = items;
          sendJson(client, {
            type: 'conversation:citations',
            sessionId: session.sessionId,
            turnId,
            payload: { citations: items },
          });
        },
      });
      const latencyMs = Date.now() - startedAt;
      ragTrace = this.turnSideEffects.buildRagTrace({
        result,
        profileId,
        latencyMs,
      });
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
      this.markFinalize(client, session, turnId);
      this.sessionRegistry.update(session.sessionId, { sentenceBuffer: '' });

      const isInterrupted = status === 'interrupted';

      // Turn protocol: end
      await this.turnSideEffects.onTurnEnd({
        conversationId: session.conversationId,
        turnId,
        userMessage,
        assistantReply: fullReply,
        status,
        citations,
        ragTrace,
        latencyMs: Date.now() - startedAt,
        ownerId: session.accessScope?.ownerId ?? session.ownerId,
        department:
          session.accessScope?.department ?? session.department ?? null,
        persistAssistant: !isInterrupted || fullReply.trim().length > 0,
        sideEffectFlags: options?.sideEffectFlags,
      });

      if (shouldSendError) {
        sendJson(client, {
          type: 'error',
          sessionId: session.sessionId,
          payload: { message: 'Agent error' },
        });
      }

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
      const sentenceEndMatch = /[。？！；]/.exec(buffer);
      if (sentenceEndMatch) {
        splitIndex = sentenceEndMatch.index + 1;
      } else {
        const clauseRegex = /[，、：]/g;
        let match: RegExpExecArray | null;
        while ((match = clauseRegex.exec(buffer)) !== null) {
          if (match.index + 1 >= AgentPipelineService.CLAUSE_MIN_LEN) {
            splitIndex = match.index + 1;
            break;
          }
        }
        if (
          splitIndex === -1 &&
          buffer.length >= AgentPipelineService.BUFFER_MAX_LEN
        ) {
          splitIndex = AgentPipelineService.BUFFER_MAX_LEN;
        }
      }

      if (splitIndex !== -1) {
        const text = buffer.slice(0, splitIndex).trim();
        this.sessionRegistry.update(session.sessionId, {
          sentenceBuffer: buffer.slice(splitIndex),
        });
        if (text) {
          this.sendToPipeline(client, session, turnId, text);
        }
        continue;
      }

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
