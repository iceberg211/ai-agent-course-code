import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AgentService } from '@/agent/agent.service';
import type { RagWorkflowResult } from '@/agent/types/rag-workflow.types';
import { ConversationService } from '@/conversation/services/conversation.service';
import type { MessageStatus } from '@/conversation/entities/conversation-message.entity';
import type { Conversation } from '@/conversation/entities/conversation.entity';
import { PersonaService } from '@/persona/persona.service';
import { ChatRequestDto } from '@/conversation/controllers/dto/chat-request.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import { LongTermMemoryService } from '@/memory/services/long-term-memory.service';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';

interface MessagePartLike {
  type?: unknown;
  text?: unknown;
}

interface MessageLike {
  role?: unknown;
  parts?: unknown;
}

@ApiTags('chat')
@Controller('chat')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('chat:view')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly personaService: PersonaService,
    private readonly shortTermMemoryService: ShortTermMemoryService,
    private readonly longTermMemoryService: LongTermMemoryService,
  ) {}

  @Post()
  @ApiOperation({ summary: '文本对话（UIMessage 流式）' })
  async chat(
    @Body() body: ChatRequestDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const personaId = String(body.personaId ?? '').trim();
    if (!personaId) {
      throw new BadRequestException('personaId 必填');
    }

    await this.personaService.findOne(personaId);

    const ownerId = this.resolveOwnerId(body, req);
    const conversation = await this.resolveConversation(
      personaId,
      body.conversationId,
      ownerId,
    );
    const userMessage = this.extractLatestUserText(body);
    if (!userMessage) {
      throw new BadRequestException('请求中缺少用户文本');
    }

    const turnId = randomUUID();
    const textPartId = `text-${turnId}`;
    const abortController = new AbortController();
    let assistantReply = '';
    let status: MessageStatus = 'completed';
    let citations: unknown[] = [];
    let ragTrace: Record<string, unknown> | null = null;
    const startedAt = Date.now();

    const abortByDisconnect = () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    };
    req.once('aborted', abortByDisconnect);
    req.once('close', abortByDisconnect);

    await this.conversationService.addMessage({
      conversationId: conversation.id,
      turnId,
      role: 'user',
      content: userMessage,
      status: 'completed',
    });
    void this.shortTermMemoryService.appendMessage(conversation.id, {
      role: 'user',
      content: userMessage,
      turnId,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({
          type: 'start',
          messageId: turnId,
          messageMetadata: {
            conversationId: conversation.id,
            turnId,
            status: 'streaming',
          },
        });
        writer.write({ type: 'start-step' });
        writer.write({ type: 'text-start', id: textPartId });

        try {
          const result = await this.agentService.run({
            conversationId: conversation.id,
            personaId,
            userMessage,
            turnId,
            signal: abortController.signal,
            accessScope: this.accessScope(req),
            onToken: (token: string) => {
              assistantReply += token;
              writer.write({
                type: 'text-delta',
                id: textPartId,
                delta: token,
              });
            },
            onCitations: (items) => {
              citations = items;
              writer.write({
                type: 'message-metadata',
                messageMetadata: {
                  citations,
                },
              });
            },
          });
          ragTrace = this.toRagTrace(result);
          status = abortController.signal.aborted ? 'interrupted' : 'completed';
        } catch (error) {
          const isAbortError =
            (error as { name?: string })?.name === 'AbortError';
          status =
            abortController.signal.aborted || isAbortError
              ? 'interrupted'
              : 'failed';
          if (status === 'failed') {
            this.logger.error(
              `HTTP chat 执行失败: ${
                error instanceof Error
                  ? (error.stack ?? error.message)
                  : String(error)
              }`,
            );
            writer.write({
              type: 'error',
              errorText: '对话生成失败，请稍后重试',
            });
          }
        } finally {
          await this.conversationService.addMessage({
            conversationId: conversation.id,
            turnId,
            role: 'assistant',
            content: assistantReply,
            status,
            citations,
            ragTrace,
            latencyMs: Date.now() - startedAt,
          });
          if (assistantReply) {
            void this.shortTermMemoryService.appendMessage(conversation.id, {
              role: 'assistant',
              content: assistantReply,
              turnId,
            });
            if (ownerId) {
              void this.longTermMemoryService.captureFromConversation({
                ownerId,
                department: (req as any).user?.department ?? null,
                conversationId: conversation.id,
                userMessage,
                assistantMessage: assistantReply,
              });
            }
          }

          writer.write({ type: 'text-end', id: textPartId });
          writer.write({ type: 'finish-step' });
          writer.write({
            type: 'finish',
            finishReason: status === 'failed' ? 'error' : 'stop',
            messageMetadata: {
              conversationId: conversation.id,
              turnId,
              status,
              citations,
            },
          });
        }
      },
      onError: (error) => {
        this.logger.error(
          `UIMessage stream 失败: ${
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error)
          }`,
        );
        return 'stream error';
      },
    });

    res.setHeader('x-conversation-id', conversation.id);
    pipeUIMessageStreamToResponse({
      response: res,
      stream,
    });
  }

  private async resolveConversation(
    personaId: string,
    conversationId?: string,
    ownerId?: string | null,
  ): Promise<Conversation> {
    if (conversationId) {
      const existing =
        await this.conversationService.getConversationById(conversationId);
      if (!existing) {
        throw new BadRequestException('conversationId 不存在');
      }
      if (existing.personaId !== personaId) {
        throw new BadRequestException('conversationId 与 personaId 不匹配');
      }
      if ((existing.ownerId ?? null) !== (ownerId ?? null)) {
        throw new BadRequestException('conversationId 与调用方不匹配');
      }
      return existing;
    }

    if (ownerId) {
      const latest =
        await this.conversationService.getLatestConversationByPersona(
          personaId,
          ownerId,
        );
      if (latest) {
        return latest;
      }
    }
    return this.conversationService.createConversation(
      personaId,
      ownerId ?? null,
    );
  }

  private resolveOwnerId(body: ChatRequestDto, req: Request): string | null {
    const user = (req as any).user;
    if (!user || !user.id) {
      throw new BadRequestException('未检测到合法用户登录信息');
    }
    return user.id;
  }

  private accessScope(req: Request) {
    const user = (req as any).user;
    return {
      ownerId: user?.id ?? null,
      department: user?.department ?? null,
      role: user?.role ?? null,
    };
  }

  private normalizeOwnerId(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = String(raw ?? '').trim();
    return normalized ? normalized.slice(0, 120) : null;
  }

  private extractLatestUserText(body: ChatRequestDto): string {
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as MessageLike;
      if (msg?.role !== 'user') continue;
      const parts = Array.isArray(msg.parts) ? msg.parts : [];
      const text = parts
        .map((part) => {
          const p = part as MessagePartLike;
          if (p?.type !== 'text') return '';
          return typeof p.text === 'string' ? p.text : '';
        })
        .join('')
        .trim();
      if (text) {
        return text;
      }
    }

    return '';
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
      memory: {
        shortTermWindowCount: state.shortTermMemory.window.length,
        hasShortTermSummary: Boolean(state.shortTermMemory.summary),
        longTermMemoryCount: state.longTermMemories.length,
        longTermMemories: state.longTermMemories.map((item) => ({
          id: item.id,
          category: item.category,
          visibility: item.visibility,
          confidence: item.confidence,
          sourceConversationId: item.sourceConversationId,
        })),
      },
      enough: state.enough,
      missingFacts: state.missingFacts,
      evaluationReason: state.evaluationReason,
      webSearchUsed: state.webSearchUsed,
      webSearchQueries: state.webSearchQueries,
      stopReason: state.stopReason,
      orchestrator: state.orchestrator,
    };
  }
}
