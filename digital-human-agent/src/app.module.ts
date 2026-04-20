import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from '@/agent/agent.module';
import { AsrModule } from '@/asr/asr.module';
import { ChatModule } from '@/chat/chat.module';
import { validateEnv } from '@/config/env.validation';
import { ConversationModule } from '@/conversation/conversation.module';
import { DatabaseModule } from '@/database/database.module';
import { DigitalHumanModule } from '@/digital-human/digital-human.module';
import { GatewayModule } from '@/gateway/gateway.module';
import { HealthModule } from '@/health/health.module';
import { KnowledgeContentModule } from '@/knowledge-content/knowledge-content.module';
import { KnowledgeModule } from '@/knowledge/knowledge.module';
import { PersonaModule } from '@/persona/persona.module';
import { RealtimeSessionModule } from '@/realtime-session/realtime-session.module';
import { TtsModule } from '@/tts/tts.module';
import { VoiceCloneModule } from '@/voice-clone/voice-clone.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    PersonaModule,
    ConversationModule,
    KnowledgeModule,
    KnowledgeContentModule,
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
