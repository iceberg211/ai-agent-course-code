import { Injectable, Logger } from '@nestjs/common';
import { ConversationService } from '@/conversation/services/conversation.service';
import type { MessageStatus } from '@/conversation/entities/conversation-message.entity';
import { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import { LongTermMemoryService } from '@/memory/services/long-term-memory.service';
import type { RagWorkflowResult } from '@/agent/types/rag-workflow.types';
import type { RagProfileId } from '@/common/rag/rag-profile';
import { toRagTracePayload } from '@/common/rag/rag-turn-report';
import { withTimeout } from '@/common/utils';

/**
 * Turn 副作用协议（HTTP / WS 共用）：
 * - onTurnStart: 落库 user + 短期记忆 user
 * - onEvidenceReady: 由调用方推 citations（实时通道）
 * - onTurnEnd: 落库 assistant + 记忆 + 摘要折叠 + 长期偏好 + activeContext
 *
 * 协议目标：副作用集中、可追踪，避免 Controller/Pipeline 分叉拷贝。
 */
@Injectable()
export class TurnSideEffectService {
  private readonly logger = new Logger(TurnSideEffectService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly shortTermMemoryService: ShortTermMemoryService,
    private readonly longTermMemoryService: LongTermMemoryService,
  ) {}

  async onTurnStart(input: {
    conversationId: string;
    turnId: string;
    userMessage: string;
  }): Promise<string[]> {
    const flags: string[] = [];
    try {
      await this.conversationService.addMessage({
        conversationId: input.conversationId,
        turnId: input.turnId,
        role: 'user',
        content: input.userMessage,
        status: 'completed',
      });
    } catch (error) {
      flags.push('side_effect_user_persist_failed');
      this.logger.error(
        `onTurnStart 落库 user 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    try {
      await this.shortTermMemoryService.appendMessage(input.conversationId, {
        role: 'user',
        content: input.userMessage,
        turnId: input.turnId,
      });
    } catch (error) {
      flags.push('side_effect_user_memory_failed');
      this.logger.warn(
        `onTurnStart 短期记忆失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return flags;
  }

  buildRagTrace(input: {
    result: RagWorkflowResult;
    profileId: RagProfileId;
    latencyMs: number;
    extraDegradationFlags?: string[];
  }): Record<string, unknown> {
    const payload = toRagTracePayload(input.result, {
      profileId:
        input.result.profileId ??
        input.result.state.profileId ??
        input.profileId,
      latencyMs: input.latencyMs,
    });
    return this.mergeDegradationFlags(payload, input.extraDegradationFlags);
  }

  mergeDegradationFlags(
    ragTrace: Record<string, unknown> | null | undefined,
    flags?: string[] | null,
  ): Record<string, unknown> {
    const base = { ...(ragTrace ?? {}) };
    if (!flags?.length) {
      return base;
    }
    const existing = Array.isArray(base.degradationFlags)
      ? (base.degradationFlags as string[])
      : [];
    const merged = Array.from(
      new Set([...existing, ...flags.map((f) => f.trim()).filter(Boolean)]),
    ).sort();
    base.degradationFlags = merged;
    if (base.report && typeof base.report === 'object') {
      const report = base.report as Record<string, unknown>;
      const reportFlags = Array.isArray(report.degradationFlags)
        ? (report.degradationFlags as string[])
        : [];
      report.degradationFlags = Array.from(
        new Set([...reportFlags, ...merged]),
      ).sort();
      base.report = report;
    }
    return base;
  }

  async onTurnEnd(input: {
    conversationId: string;
    turnId: string;
    userMessage: string;
    assistantReply: string;
    status: MessageStatus;
    citations: unknown[];
    ragTrace: Record<string, unknown> | null;
    latencyMs: number;
    ownerId?: string | null;
    department?: string | null;
    /** 无有效回复时是否仍写 assistant（默认：非 interrupted 或有文本） */
    persistAssistant?: boolean;
    /** onTurnStart 等已收集的副作用 flag */
    sideEffectFlags?: string[];
  }): Promise<void> {
    const hasReply = input.assistantReply.trim().length > 0;
    const shouldPersist =
      input.persistAssistant ?? (input.status !== 'interrupted' || hasReply);

    const ragTrace = this.mergeDegradationFlags(input.ragTrace, [
      ...(input.sideEffectFlags ?? []),
    ]);

    let persistedMessageId: string | null = null;
    if (shouldPersist) {
      try {
        const message = await this.conversationService.addMessage({
          conversationId: input.conversationId,
          turnId: input.turnId,
          role: 'assistant',
          content: input.assistantReply,
          status: input.status,
          citations: input.citations,
          ragTrace,
          latencyMs: input.latencyMs,
        });
        persistedMessageId = message?.id ?? null;
      } catch (error) {
        this.logger.error(
          `onTurnEnd 落库 assistant 失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // 仅在助手消息成功落库后派发记忆，避免生成“有记忆、无会话记录”的不一致状态。
    if (hasReply && persistedMessageId) {
      this.scheduleMemorySideEffects(input, persistedMessageId, ragTrace);
    }
  }

  private scheduleMemorySideEffects(
    input: {
      conversationId: string;
      turnId: string;
      userMessage: string;
      assistantReply: string;
      ownerId?: string | null;
      department?: string | null;
    },
    persistedMessageId: string | null,
    ragTrace: Record<string, unknown>,
  ): void {
    setImmediate(() => {
      void this.runMemorySideEffects(input, persistedMessageId, ragTrace);
    });
  }

  private async runMemorySideEffects(
    input: {
      conversationId: string;
      turnId: string;
      userMessage: string;
      assistantReply: string;
      ownerId?: string | null;
      department?: string | null;
    },
    persistedMessageId: string | null,
    ragTrace: Record<string, unknown>,
  ): Promise<void> {
    let flags: string[] = [];
    try {
      flags = await withTimeout(
        'turn_memory_side_effects',
        () => this.persistMemorySideEffects(input),
        {
          timeoutMs: 5_000,
          timeoutMessage: '记忆副作用执行超时',
        },
      );
    } catch (error) {
      flags = ['side_effect_memory_timeout'];
      this.logger.warn(
        `onTurnEnd 记忆副作用超时：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!persistedMessageId || flags.length === 0) return;
    try {
      await this.conversationService.updateMessageRagTrace(
        persistedMessageId,
        this.mergeDegradationFlags(ragTrace, flags),
      );
    } catch (error) {
      this.logger.warn(
        `更新助手消息副作用标记失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async persistMemorySideEffects(input: {
    conversationId: string;
    turnId: string;
    userMessage: string;
    assistantReply: string;
    ownerId?: string | null;
    department?: string | null;
  }): Promise<string[]> {
    const flags: string[] = [];
    try {
      await this.shortTermMemoryService.appendMessage(input.conversationId, {
        role: 'assistant',
        content: input.assistantReply,
        turnId: input.turnId,
      });
      await this.shortTermMemoryService.refreshSummaryFromWindow(
        input.conversationId,
      );

      if (input.ownerId) {
        await this.shortTermMemoryService.setActiveContext(
          input.ownerId,
          `最近问题：${input.userMessage.slice(0, 200)}`,
        );
        try {
          await this.longTermMemoryService.captureFromConversation({
            ownerId: input.ownerId,
            department: input.department ?? null,
            conversationId: input.conversationId,
            userMessage: input.userMessage,
            assistantMessage: input.assistantReply,
          });
        } catch (error) {
          flags.push('side_effect_ltm_capture_failed');
          this.logger.warn(
            `onTurnEnd 长期记忆捕获失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      flags.push('side_effect_memory_failed');
      this.logger.warn(
        `onTurnEnd 记忆副作用失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return flags;
  }
}
