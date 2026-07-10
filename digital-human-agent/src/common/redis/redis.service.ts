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
    if (this.client.status !== 'ready') {
      await this.client.connect().catch((error) => {
        this.logger.debug(
          `Redis connect 失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    return this.client.status === 'ready' ? this.client : this.client;
  }

  async onModuleDestroy(): Promise<void> {
    // 仅断开 factory 未注入、由本服务创建的连接
    this.ownedClient?.disconnect();
  }
}
