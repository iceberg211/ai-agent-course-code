import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { PersonaModule } from './persona/persona.module';
import { ConversationModule } from './conversation/conversation.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { AsrModule } from './asr/asr.module';
import { TtsModule } from './tts/tts.module';
import { RealtimeSessionModule } from './realtime-session/realtime-session.module';
import { AgentModule } from './agent/agent.module';
import { GatewayModule } from './gateway/gateway.module';
import { ChatModule } from './chat/chat.module';
import { VoiceCloneModule } from './voice-clone/voice-clone.module';
import { DigitalHumanModule } from './digital-human/digital-human.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    PersonaModule,
    ConversationModule,
    KnowledgeModule,
    KnowledgeBaseModule,
    AsrModule,
    TtsModule,
    RealtimeSessionModule,
    AgentModule,
    GatewayModule,
    ChatModule,
    VoiceCloneModule,
    DigitalHumanModule,
    HealthModule,
  ],
})
export class AppModule {}
