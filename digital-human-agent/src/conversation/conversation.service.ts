import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './conversation.entity';
import { ConversationMessage, MessageRole, MessageStatus } from './conversation-message.entity';

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

  getLatestConversationByPersona(personaId: string): Promise<Conversation | null> {
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

  // 只取 status=completed 的消息用于 Prompt（打断/失败的不回灌给模型）
  getCompletedMessages(conversationId: string, limit = 10): Promise<ConversationMessage[]> {
    return this.msgRepo.find({
      where: { conversationId, status: 'completed' },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  // UI 历史显示用，包含所有状态
  getAllMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
    return this.msgRepo.update(id, { status }).then(() => undefined);
  }
}
