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
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import type { DocumentJobData } from './document-task.types';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
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

  constructor(
    private readonly configService: ConfigService,
    private readonly runner: DocumentTaskRunnerService,
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

        this.logger.log(`[Worker] 开始处理任务 taskId=${taskId}`);

        const bucket =
          this.configService.get<string>('S3_BUCKET') || 'enterprise-kb';

        // 1. 从 MinIO 获取原始文件 Buffer
        const stream = await this.storageProvider.getObject({
          bucket,
          key: originalStorageKey,
        });
        const buffer = await streamToBuffer(stream);

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
    if (this.worker) {
      await this.worker.close();
    }
    if (this.redisClient) {
      this.redisClient.disconnect();
    }
  }
}
