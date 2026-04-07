import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from '@/database/database.module';
import { TaskModule } from '@/task/task.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { AgentModule } from '@/agent/agent.module';
import { EventModule } from '@/event/event.module';
import { GatewayModule } from '@/gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: true }),
    DatabaseModule,
    WorkspaceModule,
    ToolModule,
    SkillModule,
    EventModule,
    AgentModule,
    GatewayModule,
    TaskModule,
  ],
})
export class AppModule {}
