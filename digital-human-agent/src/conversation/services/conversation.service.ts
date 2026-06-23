import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { Conversation } from '@/conversation/entities/conversation.entity';
import {
  ConversationMessage,
  MessageFeedback,
  MessageRole,
  MessageStatus,
} from '@/conversation/entities/conversation-message.entity';
import {
  formatErrorMessage,
  isTransientDbError,
  normalizePage,
  normalizePageSize,
  withRetry,
} from '@/common/utils';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly msgRepo: Repository<ConversationMessage>,
  ) {}

  createConversation(
    personaId: string,
    ownerId: string | null = null,
  ): Promise<Conversation> {
    const conversation = this.convRepo.create({
      id: randomUUID(),
      personaId,
      ownerId,
    });
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
    ownerId: string | null,
  ): Promise<Conversation | null> {
    return this.withTransientRetry('getLatestConversationByPersona', () =>
      this.convRepo.findOne({
        where: { personaId, ownerId: ownerId ?? IsNull() },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  async addMessage(params: {
    conversationId: string;
    turnId: string;
    role: MessageRole;
    seq?: number;
    content: string;
    status: MessageStatus;
    citations?: unknown[] | null;
    ragTrace?: Record<string, unknown> | null;
    latencyMs?: number | null;
  }): Promise<ConversationMessage> {
    const seq =
      params.seq ?? (await this.getNextMessageSeq(params.conversationId));
    const message = this.msgRepo.create({ id: randomUUID(), ...params, seq });
    return this.withTransientRetry('addMessage', () =>
      this.msgRepo.save(message),
    );
  }

  async listConversations(params: {
    personaId?: string;
    ownerId?: string | null;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: Array<{
      id: string;
      personaId: string;
      ownerId: string | null;
      createdAt: Date;
      updatedAt: Date;
      lastMessage: ConversationMessage | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = normalizePage(params.page);
    const pageSize = normalizePageSize(params.pageSize);
    const qb = this.convRepo
      .createQueryBuilder('conversation')
      .orderBy('conversation.updated_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (params.personaId) {
      qb.andWhere('conversation.persona_id = :personaId', {
        personaId: params.personaId,
      });
    }

    if (params.ownerId !== undefined) {
      if (params.ownerId === null) {
        qb.andWhere('conversation.owner_id IS NULL');
      } else {
        qb.andWhere('conversation.owner_id = :ownerId', {
          ownerId: params.ownerId,
        });
      }
    }

    const [conversations, total] = await this.withTransientRetry(
      'listConversations',
      () => qb.getManyAndCount(),
    );

    let lastMessages: ConversationMessage[] = [];
    if (conversations.length > 0) {
      const convIds = conversations.map((c) => c.id);
      lastMessages = await this.withTransientRetry('batchGetLatestMessages', () =>
        this.msgRepo
          .createQueryBuilder('message')
          .select()
          .distinctOn(['message.conversation_id'])
          .where('message.conversation_id IN (:...convIds)', { convIds })
          .orderBy('message.conversation_id', 'ASC')
          .addOrderBy('message.seq', 'DESC')
          .addOrderBy('message.created_at', 'DESC')
          .getMany(),
      );
    }

    const messageMap = new Map(
      lastMessages.map((msg) => [msg.conversationId, msg]),
    );

    const items = conversations.map((conversation) => ({
      id: conversation.id,
      personaId: conversation.personaId,
      ownerId: conversation.ownerId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessage: messageMap.get(conversation.id) ?? null,
    }));

    return { items, total, page, pageSize };
  }

  async deleteConversation(id: string): Promise<{ id: string; deleted: boolean }> {
    const result = await this.withTransientRetry('deleteConversation', () =>
      this.convRepo.delete(id),
    );
    return { id, deleted: (result.affected ?? 0) > 0 };
  }

  async setMessageFeedback(
    conversationId: string,
    messageId: string,
    feedback: MessageFeedback | null,
  ): Promise<ConversationMessage | null> {
    await this.withTransientRetry('setMessageFeedback', () =>
      this.msgRepo.update({ id: messageId, conversationId }, { feedback }),
    );
    return this.withTransientRetry('findMessageAfterFeedback', () =>
      this.msgRepo.findOne({ where: { id: messageId, conversationId } }),
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
          order: { seq: 'DESC', createdAt: 'DESC' },
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
        order: { seq: 'DESC', createdAt: 'DESC' },
        take: safeLimit,
      }),
    );
    return recentDesc.reverse();
  }

  private async getLatestMessage(
    conversationId: string,
  ): Promise<ConversationMessage | null> {
    const rows = await this.withTransientRetry('getLatestMessage', () =>
      this.msgRepo.find({
        where: { conversationId },
        order: { seq: 'DESC', createdAt: 'DESC' },
        take: 1,
      }),
    );
    return rows[0] ?? null;
  }

  private async getNextMessageSeq(conversationId: string): Promise<number> {
    const row = await this.withTransientRetry('getNextMessageSeq', () =>
      this.msgRepo
        .createQueryBuilder('message')
        .select('COALESCE(MAX(message.seq), -1)', 'maxSeq')
        .where('message.conversation_id = :conversationId', { conversationId })
        .getRawOne<{ maxSeq: string | number | null }>(),
    );
    const maxSeq = Number(row?.maxSeq ?? -1);
    return Number.isFinite(maxSeq) ? maxSeq + 1 : 0;
  }

  private async withTransientRetry<T>(
    op: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withRetry(op, fn, {
      attempts: 3,
      initialDelayMs: 200,
      maxDelayMs: 1000,
      logger: this.logger,
      shouldRetry: isTransientDbError,
      formatRetryMessage: ({ operation, attempt, delayMs, error }) =>
        `${operation} 第 ${attempt} 次失败，检测到数据库瞬时错误，${delayMs}ms 后重试：${formatErrorMessage(
          error,
        )}`,
    });
  }
}
