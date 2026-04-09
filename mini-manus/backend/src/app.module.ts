import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { z } from 'zod';
import { DatabaseModule } from '@/database/database.module';
import { TaskModule } from '@/task/task.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { AgentModule } from '@/agent/agent.module';
import { EventModule } from '@/event/event.module';
import { GatewayModule } from '@/gateway/gateway.module';

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY 不能为空'),
    MODEL_NAME: z.string().default('gpt-4o-mini'),
    TAVILY_API_KEY: z.string().default(''),
    MAX_RETRIES: z.coerce.number().int().min(0).default(3),
    MAX_REPLANS: z.coerce.number().int().min(0).default(2),
    MAX_STEPS: z.coerce.number().int().min(1).default(20),
    STEP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
    TOOL_CACHE_TTL_MS: z.coerce.number().int().min(0).default(300_000),
  })
  .passthrough();

function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`配置校验失败：\n${messages}`);
  }
  return result.data;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
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
