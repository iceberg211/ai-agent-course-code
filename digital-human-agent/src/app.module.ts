import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from '@/agent/agent.module';
import { CommonModule } from '@/common/common.module';
import { validateEnv } from '@/config/env.validation';
import { ConversationModule } from '@/conversation/conversation.module';
import { DatabaseModule } from '@/database/database.module';
import { DigitalHumanModule } from '@/digital-human/digital-human.module';
import { GatewayModule } from '@/gateway/gateway.module';
import { HealthModule } from '@/health/health.module';
import { KnowledgeModule } from '@/knowledge/knowledge.module';
import { PersonaModule } from '@/persona/persona.module';
import { SpeechModule } from '@/speech/speech.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    CommonModule,
    DatabaseModule,
    PersonaModule,
    ConversationModule,
    KnowledgeModule,
    SpeechModule,
    AgentModule,
    GatewayModule,
    DigitalHumanModule,
    HealthModule,
  ],
})
export class AppModule {}
