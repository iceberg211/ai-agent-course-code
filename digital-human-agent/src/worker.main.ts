import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '@/app.module';

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  logger.log('正在初始化后台异步任务 Worker 进程...');
  process.env.DOCUMENT_WORKER_ENABLED = 'true';

  // 使用 createApplicationContext 以拉起所有 providers 实例，而不运行 HTTP 服务监听
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  logger.log('后台异步任务 Worker 进程已成功启动！正在监听队列...');

  // 优雅退出机制
  const shutdown = async (signal: string) => {
    logger.log(`收到信号 ${signal}，准备优雅关闭 worker...`);
    try {
      await app.close();
      logger.log('Worker 进程优雅关闭成功。');
      process.exit(0);
    } catch (err) {
      logger.error('Worker 进程关闭时遇到错误:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  const logger = new Logger('WorkerBootstrap');
  logger.error(
    `Worker 进程启动失败: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }`,
  );
  process.exit(1);
});
