import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // WS 服务器由 SpeechGateway.onApplicationBootstrap() 自动注册到 /ws/speech
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
