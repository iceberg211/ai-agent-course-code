import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { GlobalExceptionFilter } from '@/common/filters/http-exception.filter';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 关闭 NestJS 默认的 console 日志，改用 Logger 统一控制
    logger: ['error', 'warn', 'log', 'debug'],
  });
  const logger = new Logger('Bootstrap');
  const allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  // ─── 跨域 ────────────────────────────────────────────────
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // ─── 全局 API 前缀 ───────────────────────────────────────
  app.setGlobalPrefix('api');

  // ─── 全局管道：请求参数校验 ──────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 剔除 DTO 未声明的字段
      transform: true, // 自动类型转换
      forbidNonWhitelisted: true, // 非白名单字段直接 400，而非静默丢弃
    }),
  );

  // ─── 全局过滤器：统一错误格式 ────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── 全局拦截器：请求日志 ────────────────────────────────
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ─── WebSocket ──────────────────────────────────────────
  app.useWebSocketAdapter(new IoAdapter(app));

  // ─── Swagger（联调工具，只在非生产环境启用）───────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Mini-Manus API')
      .setDescription('任务型 Agent 系统接口文档')
      .setVersion('1.0')
      .addTag('tasks', '任务管理')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log('Swagger UI: http://localhost:3000/api/docs');
  }

  // ─── 启动 ────────────────────────────────────────────────
  // 优雅关闭：收到 SIGTERM 时等待进行中的请求处理完再退出
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Backend running on http://localhost:${port}/api`);
}

void bootstrap();
