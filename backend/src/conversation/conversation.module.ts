import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { ConversationService } from '@/conversation/services/conversation.service';
import { RealtimeSessionRegistry } from '@/conversation/services/realtime-session.registry';
import { TurnSideEffectService } from '@/conversation/services/turn-side-effect.service';
import { ChatController } from '@/conversation/controllers/chat.controller';
import { ConversationController } from '@/conversation/controllers/conversation.controller';
import { AgentModule } from '@/agent/agent.module';
import { PersonaModule } from '@/persona/persona.module';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';
import { MemoryModule } from '@/memory/memory.module';
import { RbacModule } from '@/rbac/rbac.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, ConversationMessage]),
    AgentModule,
    PersonaModule,
    AuthModule,
    NotificationModule,
    MemoryModule,
    RbacModule,
  ],
  controllers: [ChatController, ConversationController],
  providers: [
    ConversationService,
    RealtimeSessionRegistry,
    TurnSideEffectService,
  ],
  exports: [
    ConversationService,
    RealtimeSessionRegistry,
    TurnSideEffectService,
  ],
})
export class ConversationModule {}
