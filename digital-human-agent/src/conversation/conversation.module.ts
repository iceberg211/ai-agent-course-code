import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '@/conversation/conversation.entity';
import { ConversationMessage } from '@/conversation/conversation-message.entity';
import { ConversationService } from '@/conversation/conversation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, ConversationMessage])],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
