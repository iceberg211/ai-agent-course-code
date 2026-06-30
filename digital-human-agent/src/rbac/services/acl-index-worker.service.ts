import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  ACL_INDEX_REFRESH_QUEUE,
  type AclIndexRefreshJobData,
} from '@/rbac/services/acl-index-queue.service';
import { AclIndexRefreshService } from '@/rbac/services/acl-index-refresh.service';

@Injectable()
export class AclIndexWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AclIndexWorkerService.name);
  private worker: Worker | null = null;
  private redisClient: Redis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly refreshService: AclIndexRefreshService,
  ) {}

  onModuleInit(): void {
    const enabled = this.readBoolean('ACL_INDEX_WORKER_ENABLED', false);
    if (!enabled) {
      this.logger.log('ACL 索引刷新 Worker 未启用，当前进程不消费队列');
      return;
    }

    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.worker = new Worker(
      ACL_INDEX_REFRESH_QUEUE,
      async (job: Job<AclIndexRefreshJobData>) => {
        await this.refreshService.refreshDocumentAclIndex(job.data.documentId);
      },
      {
        connection: this.redisClient as any,
        concurrency: Number(
          this.configService.get<string>('ACL_INDEX_QUEUE_CONCURRENCY') || '3',
        ),
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `ACL 索引刷新任务失败 job=${job?.id} document=${job?.data?.documentId} error=${error.message}`,
        error.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.redisClient) this.redisClient.disconnect();
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const raw = String(this.configService.get<string>(key) ?? '').trim();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }
}
