import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly redisClient: Redis;
  private readonly queues: Map<string, Queue> = new Map();

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.logger.log(`连接 Redis 服务: ${redisUrl}`);
    this.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  getQueue(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.redisClient as any,
      });
      this.queues.set(queueName, queue);
      this.logger.log(`成功初始化队列: ${queueName}`);
    }
    return queue;
  }

  async onModuleDestroy() {
    this.logger.log('关闭队列连接...');
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.redisClient.disconnect();
  }
}
