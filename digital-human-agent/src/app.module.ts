import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AgentModule } from '@/agent/agent.module';
import { CommonModule } from '@/common/common.module';
import { validateEnv } from '@/config/env.validation';
import { ConversationModule } from '@/conversation/conversation.module';
import { DashboardModule } from '@/dashboard/dashboard.module';
import { DatabaseModule } from '@/database/database.module';
import { DigitalHumanModule } from '@/digital-human/digital-human.module';
import { GatewayModule } from '@/gateway/gateway.module';
import { HealthModule } from '@/health/health.module';
import { KnowledgeModule } from '@/knowledge/knowledge.module';
import { PersonaModule } from '@/persona/persona.module';
import { SpeechModule } from '@/speech/speech.module';
import { UserModule } from '@/user/user.module';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60 秒
        limit: 60,   // 最多 60 次
      },
    ]),
    CommonModule,
    DatabaseModule,
    UserModule,
    AuthModule,
    NotificationModule,
    PersonaModule,
    ConversationModule,
    DashboardModule,
    KnowledgeModule,
    SpeechModule,
    AgentModule,
    GatewayModule,
    DigitalHumanModule,
    HealthModule,
  ],
})
export class AppModule {}
