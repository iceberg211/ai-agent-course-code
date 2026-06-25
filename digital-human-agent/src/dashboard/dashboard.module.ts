import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { DashboardController } from '@/dashboard/dashboard.controller';
import { DashboardService } from '@/dashboard/dashboard.service';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Knowledge,
      KnowledgeDocument,
      KnowledgeChunk,
      Conversation,
      ConversationMessage,
      KnowledgeEvalCase,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
