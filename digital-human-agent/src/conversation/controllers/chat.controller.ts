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
import { ConversationService } from '@/conversation/services/conversation.service';
import type { MessageStatus } from '@/conversation/entities/conversation-message.entity';
import type { Conversation } from '@/conversation/entities/conversation.entity';
import { PersonaService } from '@/persona/persona.service';
import { ChatRequestDto } from '@/conversation/controllers/dto/chat-request.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';
import { resolveHttpChatProfileId } from '@/common/rag/rag-profile';
import { TurnSideEffectService } from '@/conversation/services/turn-side-effect.service';

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
    private readonly turnSideEffects: TurnSideEffectService,
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

    // Turn protocol: start
    const sideEffectFlags = await this.turnSideEffects.onTurnStart({
      conversationId: conversation.id,
      turnId,
      userMessage,
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
            profileId: resolveHttpChatProfileId(),
            startedAt,
            onToken: (token: string) => {
              assistantReply += token;
              writer.write({
                type: 'text-delta',
                id: textPartId,
                delta: token,
              });
            },
            onCitations: (items) => {
              // Turn protocol: evidence ready
              citations = items;
              writer.write({
                type: 'message-metadata',
                messageMetadata: {
                  citations,
                },
              });
            },
          });
          const latencyMs = Date.now() - startedAt;
          ragTrace = this.turnSideEffects.buildRagTrace({
            result,
            profileId: resolveHttpChatProfileId(),
            latencyMs,
          });
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
          // Turn protocol: end
          await this.turnSideEffects.onTurnEnd({
            conversationId: conversation.id,
            turnId,
            userMessage,
            assistantReply,
            status,
            citations,
            ragTrace,
            latencyMs: Date.now() - startedAt,
            ownerId,
            department: (req as any).user?.department ?? null,
            sideEffectFlags,
          });

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

}
