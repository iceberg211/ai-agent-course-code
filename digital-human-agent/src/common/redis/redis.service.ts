import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/common/redis/redis.constants';

/**
 * 共享 Redis 访问层：确保连接、统一 disconnect。
 * BullMQ / Worker 阻塞连接仍各自持有独立 client（maxRetriesPerRequest: null）。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly ownedClient: Redis | null = null;
  private readonly client: Redis | null;
  private connectPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(REDIS_CLIENT)
    injectedClient?: Redis | null,
  ) {
    if (injectedClient) {
      this.client = injectedClient;
      return;
    }
    // 单测或未挂 RedisModule 时本地降级创建
    try {
      const redisUrl =
        this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
      this.ownedClient = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.client = this.ownedClient;
    } catch {
      this.client = null;
    }
  }

  get raw(): Redis | null {
    return this.client;
  }

  async ensureConnected(): Promise<Redis | null> {
    if (!this.client) return null;
    if (this.client.status === 'ready') return this.client;

    if (!this.connectPromise) {
      this.connectPromise = this.connectOrWaitForReady()
        .catch((error) => {
          this.logger.debug(
            `Redis connect 失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        })
        .finally(() => {
          this.connectPromise = null;
        });
    }
    await this.connectPromise;
    return String(this.client.status) === 'ready' ? this.client : null;
  }

  private async connectOrWaitForReady(): Promise<void> {
    const client = this.client;
    if (!client || client.status === 'ready') return;
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Redis 等待 ready 超时，当前状态=${client.status}`));
      }, 2_000);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
      };
      client.once('ready', onReady);
      client.once('error', onError);
    });
  }

  onModuleDestroy(): void {
    // 仅断开 factory 未注入、由本服务创建的连接
    this.ownedClient?.disconnect();
  }
}
