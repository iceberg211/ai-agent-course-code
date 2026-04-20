import { Module } from '@nestjs/common';
import { AgentModule } from '@/agent/agent.module';
import { ConversationModule } from '@/conversation/conversation.module';
import { PersonaModule } from '@/persona/persona.module';
import { ChatController } from '@/chat/chat.controller';

@Module({
  imports: [AgentModule, ConversationModule, PersonaModule],
  controllers: [ChatController],
})
export class ChatModule {}

