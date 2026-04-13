import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { DatabaseModule } from '@/database/database.module';
import { TaskModule } from '@/task/task.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { AgentModule } from '@/agent/agent.module';
import { EventModule } from '@/event/event.module';
import { GatewayModule } from '@/gateway/gateway.module';
import { HealthModule } from '@/health/health.module';
import { ApiKeyGuard } from '@/common/auth/api-key.guard';

const envSchema = z
  .object({
    NODE_ENV: z
      .preprocess(
        (val) => (typeof val === 'string' ? val.trim() : val),
        z.enum(['development', 'test', 'production']),
      )
      .default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY 不能为空'),
    FRONTEND_URL: z.string().default('http://localhost:5173'),
    WS_ALLOWED_ORIGINS: z.string().default(''),
    WS_AUTH_TOKEN: z.string().default(''),
    APP_API_KEYS: z.string().default(''),
    MODEL_NAME: z.string().default('gpt-4o-mini'),
    TAVILY_API_KEY: z.string().default(''),
    MAX_RETRIES: z.coerce.number().int().min(0).default(3),
    MAX_REPLANS: z.coerce.number().int().min(0).default(2),
    MAX_STEPS: z.coerce.number().int().min(1).default(20),
    TOKEN_BUDGET: z.coerce.number().int().min(0).default(100_000),
    PLANNER_MAX_STEPS: z.coerce.number().int().min(1).default(8),
    PLANNER_ALLOWED_SIDE_EFFECT_TOOLS: z
      .string()
      .default('write_file,download_file,export_pdf,browser_screenshot'),
    PLANNER_ALLOWED_SIDE_EFFECT_SKILLS: z
      .string()
      .default('document_writing,report_packaging,code_project_generation'),
    STEP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
    SKILL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),
    APPROVAL_TIMEOUT_MS: z.coerce.number().int().min(5000).default(600_000),
    TOOL_CACHE_TTL_MS: z.coerce.number().int().min(0).default(300_000),
    WORKSPACE_CLEANUP_ENABLED: z.string().default('false'),
    WORKSPACE_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
    WORKSPACE_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(6 * 60 * 60 * 1000),
    BROWSER_AUTOMATION_ENABLED: z.string().default('false'),
    BROWSER_HEADLESS: z.string().default('true'),
    BROWSER_MAX_SESSIONS_PER_RUN: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(2),
    BROWSER_DEFAULT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(15_000),
    BROWSER_ACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(10_000),
    BROWSER_SESSION_TTL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(60 * 60_000)
      .default(10 * 60_000),
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

  if (
    result.data.NODE_ENV === 'production' &&
    result.data.WS_AUTH_TOKEN.trim().length === 0
  ) {
    throw new Error('配置校验失败：生产环境必须配置 WS_AUTH_TOKEN');
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.APP_API_KEYS.trim().length === 0
  ) {
    throw new Error('配置校验失败：生产环境必须配置 APP_API_KEYS');
  }

  return result.data;
}

@Module({
  providers: [
    // 全局速率限制：每个 IP 每分钟最多 60 次请求
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // 写接口 API Key 保护。未配置 APP_API_KEYS 时保持开发环境免鉴权。
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    EventEmitterModule.forRoot({ wildcard: true }),
    DatabaseModule,
    WorkspaceModule,
    ToolModule,
    SkillModule,
    EventModule,
    AgentModule,
    GatewayModule,
    TaskModule,
    HealthModule,
  ],
})
export class AppModule {}
