import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Conversation } from '@/conversation/conversation.entity';
import {
  ConversationMessage,
  MessageRole,
  MessageStatus,
} from '@/conversation/conversation-message.entity';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly msgRepo: Repository<ConversationMessage>,
  ) {}

  createConversation(personaId: string): Promise<Conversation> {
    const conversation = this.convRepo.create({ id: randomUUID(), personaId });
    return this.withTransientRetry('createConversation', () =>
      this.convRepo.save(conversation),
    );
  }

  getConversationById(id: string): Promise<Conversation | null> {
    return this.withTransientRetry('getConversationById', () =>
      this.convRepo.findOne({
        where: { id },
      }),
    );
  }

  getLatestConversationByPersona(
    personaId: string,
  ): Promise<Conversation | null> {
    return this.withTransientRetry('getLatestConversationByPersona', () =>
      this.convRepo.findOne({
        where: { personaId },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  addMessage(params: {
    conversationId: string;
    turnId: string;
    role: MessageRole;
    seq: number;
    content: string;
    status: MessageStatus;
  }): Promise<ConversationMessage> {
    const message = this.msgRepo.create({ id: randomUUID(), ...params });
    return this.withTransientRetry('addMessage', () =>
      this.msgRepo.save(message),
    );
  }

  // 只取最近的 status=completed 消息用于 Prompt（打断/失败的不回灌给模型）
  async getCompletedMessages(
    conversationId: string,
    limit = 10,
  ): Promise<ConversationMessage[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const recentDesc = await this.withTransientRetry(
      'getCompletedMessages',
      () =>
        this.msgRepo.find({
          where: { conversationId, status: 'completed' },
          order: { createdAt: 'DESC' },
          take: safeLimit,
        }),
    );
    return recentDesc.reverse();
  }

  // 仅返回最近 N 条历史，按时间正序（旧 -> 新）
  async getRecentMessages(
    conversationId: string,
    limit = 80,
  ): Promise<ConversationMessage[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const recentDesc = await this.withTransientRetry('getRecentMessages', () =>
      this.msgRepo.find({
        where: { conversationId },
        order: { createdAt: 'DESC' },
        take: safeLimit,
      }),
    );
    return recentDesc.reverse();
  }

  private isTransientDbError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error ?? '');
    return /Connection terminated unexpectedly|ECONNRESET|ETIMEDOUT|too many clients|terminating connection/i.test(
      message,
    );
  }

  private async withTransientRetry<T>(
    op: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    let delayMs = 200;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (!this.isTransientDbError(error) || attempt >= maxAttempts) {
          throw error;
        }

        this.logger.warn(
          `${op} 第 ${attempt} 次失败，检测到数据库瞬时错误，${delayMs}ms 后重试：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 1000);
      }
    }

    throw new Error(`${op} 数据库重试流程异常结束`);
  }
}
