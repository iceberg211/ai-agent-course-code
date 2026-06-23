import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { ConversationService } from '@/conversation/services/conversation.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { ChatController } from '@/conversation/controllers/chat.controller';
import { ConversationController } from '@/conversation/controllers/conversation.controller';
import { AgentModule } from '@/agent/agent.module';
import { PersonaModule } from '@/persona/persona.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, ConversationMessage]),
    AgentModule,
    PersonaModule,
  ],
  controllers: [ChatController, ConversationController],
  providers: [ConversationService, RealtimeSessionRegistry],
  exports: [ConversationService, RealtimeSessionRegistry],
})
export class ConversationModule {}
