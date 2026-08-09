import { Global, Module, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/common/redis/redis.constants';
import { RedisService } from '@/common/redis/redis.service';

/**
 * 全局共享 Redis（lazyConnect，适合 cache / 记忆 / epoch）。
 * 不用于 BullMQ Worker（需要 maxRetriesPerRequest: null 的独立连接）。
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis | null => {
        try {
          const redisUrl =
            configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
          return new Redis(redisUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
          });
        } catch {
          return null;
        }
      },
    },
    RedisService,
    {
      provide: 'REDIS_CLIENT_LIFECYCLE',
      inject: [REDIS_CLIENT],
      useFactory: (client: Redis | null) =>
        new RedisClientLifecycle(client),
    },
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}

class RedisClientLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger('RedisClientLifecycle');

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  async onModuleDestroy(): Promise<void> {
    try {
      this.client?.disconnect();
    } catch (error) {
      this.logger.debug(
        `Redis disconnect: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
