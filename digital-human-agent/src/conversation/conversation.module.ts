import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './conversation.entity';
import { ConversationMessage } from './conversation-message.entity';
import { ConversationService } from './conversation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, ConversationMessage])],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
