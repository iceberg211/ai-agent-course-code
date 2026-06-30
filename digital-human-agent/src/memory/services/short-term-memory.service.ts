import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type {
  ConversationMemoryItem,
  ShortTermMemoryContext,
} from '@/memory/memory.types';

@Injectable()
export class ShortTermMemoryService implements OnModuleDestroy {
  private readonly logger = new Logger(ShortTermMemoryService.name);
  private readonly redis: Redis;
  private failureCount = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async appendMessage(
    conversationId: string,
    item: ConversationMemoryItem,
  ): Promise<void> {
    await this.safeRun(async () => {
      const key = this.windowKey(conversationId);
      const limit = this.windowLimit;
      const ttl = this.ttlSeconds;
      await this.redis.lpush(key, JSON.stringify({
        ...item,
        createdAt: item.createdAt ?? new Date().toISOString(),
      }));
      await this.redis.ltrim(key, 0, limit - 1);
      await this.redis.expire(key, ttl);
    });
  }

  async getContext(conversationId: string, ownerId?: string | null): Promise<ShortTermMemoryContext> {
    const fallback: ShortTermMemoryContext = {
      window: [],
      summary: '',
      activeContext: '',
    };
    return this.safeRun(async () => {
      const [windowRows, summary, activeContext] = await Promise.all([
        this.redis.lrange(this.windowKey(conversationId), 0, this.windowLimit - 1),
        this.redis.get(this.summaryKey(conversationId)),
        ownerId ? this.redis.get(this.activeContextKey(ownerId)) : Promise.resolve(null),
      ]);
      return {
        window: windowRows
          .map((row) => safeParseMemoryItem(row))
          .filter((item): item is ConversationMemoryItem => Boolean(item))
          .reverse(),
        summary: summary ?? '',
        activeContext: activeContext ?? '',
      };
    }, fallback);
  }

  async setSummary(conversationId: string, summary: string): Promise<void> {
    await this.safeRun(async () => {
      await this.redis.set(
        this.summaryKey(conversationId),
        summary.slice(0, 4000),
        'EX',
        this.ttlSeconds,
      );
    });
  }

  async setActiveContext(ownerId: string, context: string): Promise<void> {
    await this.safeRun(async () => {
      await this.redis.set(
        this.activeContextKey(ownerId),
        context.slice(0, 4000),
        'EX',
        this.ttlSeconds,
      );
    });
  }

  async getRetrievalCache<T>(queryHash: string): Promise<T | null> {
    return this.safeRun(async () => {
      const value = await this.redis.get(`rag:retrieval-cache:${queryHash}`);
      return value ? (JSON.parse(value) as T) : null;
    }, null);
  }

  async setRetrievalCache(
    queryHash: string,
    value: unknown,
    ttlSeconds = 300,
  ): Promise<void> {
    await this.safeRun(async () => {
      await this.redis.set(
        `rag:retrieval-cache:${queryHash}`,
        JSON.stringify(value),
        'EX',
        Math.min(Math.max(ttlSeconds, 30), 3600),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }

  private async safeRun<T>(
    fn: () => Promise<T>,
    fallback?: T,
  ): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) {
      return fallback as T;
    }
    try {
      const result = await fn();
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount += 1;
      if (this.failureCount >= this.failureThreshold) {
        this.circuitOpenUntil = Date.now() + this.circuitTtlMs;
      }
      this.logger.warn(
        `短期记忆 Redis 调用失败，已降级：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback as T;
    }
  }

  private windowKey(conversationId: string): string {
    return `conversation:${conversationId}:window`;
  }

  private summaryKey(conversationId: string): string {
    return `conversation:${conversationId}:summary`;
  }

  private activeContextKey(ownerId: string): string {
    return `user:${ownerId}:active-context`;
  }

  private get windowLimit(): number {
    return this.clampNumber(
      this.configService.get<string>('SHORT_MEMORY_WINDOW_SIZE'),
      12,
      2,
      50,
    );
  }

  private get ttlSeconds(): number {
    return this.clampNumber(
      this.configService.get<string>('SHORT_MEMORY_TTL_SECONDS'),
      86_400,
      60,
      604_800,
    );
  }

  private get failureThreshold(): number {
    return this.clampNumber(
      this.configService.get<string>('SHORT_MEMORY_FAILURE_THRESHOLD'),
      3,
      1,
      10,
    );
  }

  private get circuitTtlMs(): number {
    return this.clampNumber(
      this.configService.get<string>('SHORT_MEMORY_CIRCUIT_TTL_MS'),
      30_000,
      1_000,
      300_000,
    );
  }

  private clampNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  }
}

function safeParseMemoryItem(value: string): ConversationMemoryItem | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.content !== 'string') return null;
    const role = parsed.role === 'assistant' || parsed.role === 'system'
      ? parsed.role
      : 'user';
    return {
      role,
      content: parsed.content,
      turnId: parsed.turnId ?? null,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

