import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Knowledge)
    private readonly knowledgeRepo: Repository<Knowledge>,
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly messageRepo: Repository<ConversationMessage>,
  ) {}

  async summary() {
    const [
      knowledgeBaseCount,
      documentCount,
      chunkCount,
      failedDocumentCount,
      conversationCount,
      messageCount,
      recentDocuments,
      recentConversations,
    ] = await Promise.all([
      this.knowledgeRepo.count(),
      this.documentRepo.count(),
      this.chunkRepo.count(),
      this.documentRepo.count({ where: { status: 'failed' } }),
      this.conversationRepo.count(),
      this.messageRepo.count(),
      this.documentRepo.find({
        relations: ['knowledge'],
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.conversationRepo.find({
        order: { updatedAt: 'DESC' },
        take: 5,
      }),
    ]);

    return {
      knowledgeBaseCount,
      documentCount,
      chunkCount,
      failedDocumentCount,
      conversationCount,
      messageCount,
      recentDocuments,
      recentConversations,
    };
  }
}
