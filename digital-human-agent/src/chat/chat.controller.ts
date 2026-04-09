import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentService } from '../agent/agent.service';
import { ConversationService } from '../conversation/conversation.service';
import type { MessageStatus } from '../conversation/conversation-message.entity';
import type { Conversation } from '../conversation/conversation.entity';
import { PersonaService } from '../persona/persona.service';
import { ChatRequestDto } from './dto/chat-request.dto';

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
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly personaService: PersonaService,
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

    const conversation = await this.resolveConversation(
      personaId,
      body.conversationId,
    );
    const userMessage = this.extractLatestUserText(body);
    if (!userMessage) {
      throw new BadRequestException('请求中缺少用户文本');
    }

    const turnId = uuidv4();
    const textPartId = `text-${turnId}`;
    const abortController = new AbortController();
    let assistantReply = '';
    let status: MessageStatus = 'completed';
    let citations: unknown[] = [];

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
      seq: 0,
      content: userMessage,
      status: 'completed',
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
          await this.agentService.run({
            conversationId: conversation.id,
            personaId,
            userMessage,
            turnId,
            signal: abortController.signal,
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
          status = abortController.signal.aborted ? 'interrupted' : 'completed';
        } catch (error) {
          status = abortController.signal.aborted ? 'interrupted' : 'failed';
          if (status === 'failed') {
            this.logger.error(
              `HTTP chat 执行失败: ${
                error instanceof Error ? error.stack ?? error.message : String(error)
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
            seq: 0,
            content: assistantReply,
            status,
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
            error instanceof Error ? error.stack ?? error.message : String(error)
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
      return existing;
    }

    const latest =
      await this.conversationService.getLatestConversationByPersona(personaId);
    if (latest) {
      return latest;
    }
    return this.conversationService.createConversation(personaId);
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

