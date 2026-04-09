import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { PersonaModule } from './persona/persona.module';
import { ConversationModule } from './conversation/conversation.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AsrModule } from './asr/asr.module';
import { TtsModule } from './tts/tts.module';
import { RealtimeSessionModule } from './realtime-session/realtime-session.module';
import { AgentModule } from './agent/agent.module';
import { GatewayModule } from './gateway/gateway.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    PersonaModule,
    ConversationModule,
    KnowledgeModule,
    AsrModule,
    TtsModule,
    RealtimeSessionModule,
    AgentModule,
    GatewayModule,
    ChatModule,
  ],
})
export class AppModule {}
