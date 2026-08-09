import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/common/redis/redis.service';

/**
 * 知识库内容与检索配置的缓存版本。
 * 内容导入、删除或检索配置更新后递增版本，使旧检索缓存自然失效。
 */
@Injectable()
export class KnowledgeCacheRevisionService {
  private readonly logger = new Logger(KnowledgeCacheRevisionService.name);

  constructor(private readonly redisService: RedisService) {}

  async getRevisions(
    knowledgeBaseIds: string[],
  ): Promise<Record<string, number> | null> {
    const ids = Array.from(new Set(knowledgeBaseIds.filter(Boolean))).sort();
    if (ids.length === 0) return {};
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return null;
      const values = await redis.mget(ids.map((id) => this.key(id)));
      return Object.fromEntries(
        ids.map((id, index) => [id, this.toRevision(values[index])]),
      );
    } catch (error) {
      this.logger.debug(
        `读取知识库缓存版本失败，跳过检索缓存：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async bumpRevision(knowledgeBaseId: string): Promise<void> {
    if (!knowledgeBaseId) return;
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return;
      // 使用 Redis 原子自增而不是时间戳：同一毫秒内连续两次变更也必须产生不同版本。
      await redis.incr(this.key(knowledgeBaseId));
    } catch (error) {
      this.logger.debug(
        `更新知识库缓存版本失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private key(knowledgeBaseId: string): string {
    return `kb:${knowledgeBaseId}:retrieval_revision`;
  }

  private toRevision(value: string | null): number {
    const revision = Number(value ?? 0);
    return Number.isFinite(revision) && revision >= 0 ? revision : 0;
  }
}
