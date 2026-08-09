import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { Readable } from 'node:stream';
import { DocumentTaskRunnerService } from './document-task-runner.service';
import { DocumentTaskService } from './document-task.service';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import type { DocumentJobData } from './document-task.types';

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`原始文件超过 Worker 读取上限 ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class DocumentTaskWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentTaskWorkerService.name);
  private worker: Worker;
  private redisClient: Redis;
  private heartbeatTimer: any = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly runner: DocumentTaskRunnerService,
    private readonly taskService: DocumentTaskService,
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider: ObjectStorageProvider,
  ) {}

  onModuleInit() {
    const enabled =
      String(
        this.configService.get<string>('DOCUMENT_WORKER_ENABLED') ?? 'false',
      ).toLowerCase() === 'true';
    if (!enabled) {
      this.logger.log('文档任务 Worker 未启用，当前进程不消费队列');
      return;
    }

    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.redisClient.set('worker:heartbeat', Date.now().toString());
      } catch (err) {
        this.logger.warn(
          `写入 Worker 心跳失败: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }, 5000);

    this.logger.log(`初始化后台异步任务 Worker，监听队列: document-processing`);

    this.worker = new Worker(
      'document-processing',
      async (job: Job<DocumentJobData>) => {
        const {
          taskId,
          knowledgeBaseId,
          originalStorageKey,
          filename,
          mimetype,
          size,
          input,
        } = job.data;

        try {
          this.logger.log(`[Worker] 开始处理任务 taskId=${taskId}`);

          const bucket =
            this.configService.get<string>('S3_BUCKET') || 'enterprise-kb';
          const maxBufferBytes = this.maxBufferBytes;
          if (size > maxBufferBytes) {
            throw new Error(`原始文件大小 ${size} 超过 Worker 读取上限 ${maxBufferBytes}`);
          }

          // 1. 从 MinIO 获取原始文件 Buffer
          const stream = await this.storageProvider.getObject({
            bucket,
            key: originalStorageKey,
          });
          const buffer = await streamToBuffer(stream, maxBufferBytes);

          const file = {
            originalname: filename,
            mimetype,
            buffer,
            size,
          };

          // 2. 调用 Runner 模块顺序执行解析与入库
          await this.runner.runUploadIngestTask({
            taskId,
            knowledgeBaseId,
            file,
            input,
          });

          this.logger.log(`[Worker] 任务完成 taskId=${taskId}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.taskService.markTaskFailed(
            taskId,
            `Worker 执行失败: ${errorMessage}`,
          );
          throw error;
        }
      },
      {
        connection: this.redisClient as any,
        concurrency: Number(
          this.configService.get<string>('DOCUMENT_QUEUE_CONCURRENCY') || '3',
        ),
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `任务失败 job=${job?.id} error=${err.message}`,
        err.stack,
      );
    });
  }

  async onModuleDestroy() {
    this.logger.log('关闭异步任务 Worker...');
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.worker) {
      await this.worker.close();
    }
    if (this.redisClient) {
      this.redisClient.disconnect();
    }
  }

  private get maxBufferBytes(): number {
    const raw = Number(
      this.configService.get<string>('DOCUMENT_WORKER_MAX_BUFFER_BYTES'),
    );
    if (Number.isFinite(raw) && raw > 0) return raw;
    return 120 * 1024 * 1024;
  }
}
