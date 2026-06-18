import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import {
  BadRequestException,
  Logger,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { AccessTokenGuard } from '@/common/security/access-token.guard';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { RequestNormalizePipe } from '@/common/pipes/request-normalize.pipe';

function resolveCorsOptions(configService: ConfigService): CorsOptions {
  const origins = String(configService.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    origin:
      origins.length > 0
        ? origins
        : process.env.NODE_ENV === 'production'
          ? false
          : true,
    credentials: true,
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new RequestNormalizePipe(),
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: '请求参数校验失败',
          errors: errors.map((e) => ({
            field: e.property,
            errors: Object.values(e.constraints ?? {}),
          })),
        }),
    }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalGuards(app.get(AccessTokenGuard));
  app.enableCors(resolveCorsOptions(configService));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Digital Human Agent API')
    .setDescription('数字人 Agent 后端接口文档')
    .setVersion('1.0.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
    },
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  logger.log(`HTTP 服务已启动: http://localhost:${port}`);
  logger.log(`Swagger 文档: http://localhost:${port}/api/docs`);
}
bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    `应用启动失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
