import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '@/conversation/conversation.entity';
import {
  ConversationMessage,
  MessageRole,
  MessageStatus,
} from '@/conversation/conversation-message.entity';

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly msgRepo: Repository<ConversationMessage>,
  ) {}

  createConversation(personaId: string): Promise<Conversation> {
    return this.convRepo.save(this.convRepo.create({ personaId }));
  }

  getConversationById(id: string): Promise<Conversation | null> {
    return this.convRepo.findOne({
      where: { id },
    });
  }

  getLatestConversationByPersona(
    personaId: string,
  ): Promise<Conversation | null> {
    return this.convRepo.findOne({
      where: { personaId },
      order: { createdAt: 'DESC' },
    });
  }

  addMessage(params: {
    conversationId: string;
    turnId: string;
    role: MessageRole;
    seq: number;
    content: string;
    status: MessageStatus;
  }): Promise<ConversationMessage> {
    return this.msgRepo.save(this.msgRepo.create(params));
  }

  // 只取最近的 status=completed 消息用于 Prompt（打断/失败的不回灌给模型）
  async getCompletedMessages(
    conversationId: string,
    limit = 10,
  ): Promise<ConversationMessage[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const recentDesc = await this.msgRepo.find({
      where: { conversationId, status: 'completed' },
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
    return recentDesc.reverse();
  }

  // UI 历史显示用，包含所有状态
  getAllMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  // 仅返回最近 N 条历史，按时间正序（旧 -> 新）
  async getRecentMessages(
    conversationId: string,
    limit = 80,
  ): Promise<ConversationMessage[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const recentDesc = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
    return recentDesc.reverse();
  }

  updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
    return this.msgRepo.update(id, { status }).then(() => undefined);
  }
}
