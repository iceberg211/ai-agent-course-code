import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type {
  ConversationMemoryItem,
  ShortTermMemoryContext,
} from '@/memory/memory.types';
import { foldOverflowIntoSummary } from '@/memory/utils/rolling-summary.utils';
import { RedisService } from '@/common/redis/redis.service';

@Injectable()
export class ShortTermMemoryService {
  private readonly logger = new Logger(ShortTermMemoryService.name);
  private failureCount = 0;
  private circuitOpenUntil = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private async redis(): Promise<Redis> {
    const client = await this.redisService.ensureConnected();
    if (!client) {
      throw new Error('Redis 不可用');
    }
    return client;
  }

  /**
   * 追加消息；若触发窗口截断，将被挤出的旧消息折叠进 summary（真滚动摘要）。
   */
  async appendMessage(
    conversationId: string,
    item: ConversationMemoryItem,
  ): Promise<void> {
    await this.safeRun(async () => {
      const redis = await this.redis();
      const key = this.windowKey(conversationId);
      const limit = this.windowLimit;
      const ttl = this.ttlSeconds;

      await redis.lpush(
        key,
        JSON.stringify({
          ...item,
          createdAt: item.createdAt ?? new Date().toISOString(),
        }),
      );

      const overflowRows = await redis.lrange(key, limit, -1);
      if (overflowRows.length > 0) {
        const overflowItems = overflowRows
          .map((row) => safeParseMemoryItem(row))
          .filter((row): row is ConversationMemoryItem => Boolean(row))
          .reverse();
        const previousSummary =
          (await redis.get(this.summaryKey(conversationId))) ?? '';
        const nextSummary = foldOverflowIntoSummary(
          previousSummary,
          overflowItems,
        );
        await redis.set(
          this.summaryKey(conversationId),
          nextSummary,
          'EX',
          ttl,
        );
      }

      await redis.ltrim(key, 0, limit - 1);
      await redis.expire(key, ttl);
    });
  }

  async getContext(
    conversationId: string,
    ownerId?: string | null,
  ): Promise<ShortTermMemoryContext> {
    const fallback: ShortTermMemoryContext = {
      window: [],
      summary: '',
      activeContext: '',
    };
    return this.safeRun(async () => {
      const redis = await this.redis();
      const [windowRows, summary, activeContext] = await Promise.all([
        redis.lrange(this.windowKey(conversationId), 0, this.windowLimit - 1),
        redis.get(this.summaryKey(conversationId)),
        ownerId
          ? redis.get(this.activeContextKey(ownerId))
          : Promise.resolve(null),
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
      const redis = await this.redis();
      await redis.set(
        this.summaryKey(conversationId),
        summary.slice(0, 4000),
        'EX',
        this.ttlSeconds,
      );
    });
  }

  async setActiveContext(ownerId: string, context: string): Promise<void> {
    await this.safeRun(async () => {
      const redis = await this.redis();
      await redis.set(
        this.activeContextKey(ownerId),
        context.slice(0, 4000),
        'EX',
        this.ttlSeconds,
      );
    });
  }

  /**
   * 兼容旧调用：在不溢出时用窗口尾部轻量刷新摘要；
   * 优先依赖 appendMessage 的溢出折叠，本方法作兜底。
   */
  async refreshSummaryFromWindow(conversationId: string): Promise<void> {
    await this.safeRun(async () => {
      const redis = await this.redis();
      const [windowRows, existing] = await Promise.all([
        redis.lrange(this.windowKey(conversationId), 0, this.windowLimit - 1),
        redis.get(this.summaryKey(conversationId)),
      ]);
      const items = windowRows
        .map((row) => safeParseMemoryItem(row))
        .filter((item): item is ConversationMemoryItem => Boolean(item))
        .reverse();
      if (items.length === 0) {
        return;
      }

      if (existing?.trim()) {
        await redis.expire(this.summaryKey(conversationId), this.ttlSeconds);
        return;
      }

      const seedCount = Math.max(1, Math.floor(items.length / 2));
      const seed = items.slice(0, seedCount);
      const summary = foldOverflowIntoSummary('', seed);
      await redis.set(
        this.summaryKey(conversationId),
        summary,
        'EX',
        this.ttlSeconds,
      );
    });
  }

  private async safeRun<T>(fn: () => Promise<T>, fallback?: T): Promise<T> {
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
    const role =
      parsed.role === 'assistant' || parsed.role === 'system'
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
