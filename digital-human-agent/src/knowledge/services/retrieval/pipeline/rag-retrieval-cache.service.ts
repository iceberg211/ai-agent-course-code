import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  hashAclSnapshot,
  hashQueryKey,
  type AclSnapshot,
} from '@/common/rag/acl-snapshot';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import { RedisService } from '@/common/redis/redis.service';

export interface CachedRetrievalResult {
  chunks: KnowledgeChunk[];
  knowledgeCount?: number;
  rerankLimit?: number;
}

interface RetrievalCacheKeyInput {
  profileId: string;
  personaId: string;
  queryKeyParts: string[];
  aclSnapshot: AclSnapshot;
  scopeKey?: string;
}

/**
 * RAG 缓存：
 * 1) embedding：仅 query+model，与 ACL 无关
 * 2) retrieval：必须含 AclSnapshot hash，权限变更后 miss
 */
@Injectable()
export class RagRetrievalCacheService {
  private readonly logger = new Logger(RagRetrievalCacheService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    const flag = String(
      this.configService.get<string>('RAG_RETRIEVAL_CACHE_ENABLED') ?? 'true',
    )
      .trim()
      .toLowerCase();
    this.enabled = flag !== 'false' && flag !== '0';
  }

  private get ttlSeconds(): number {
    const raw = Number(
      this.configService.get<string>('RAG_RETRIEVAL_CACHE_TTL_SECONDS') ?? 300,
    );
    if (!Number.isFinite(raw)) return 300;
    return Math.min(3600, Math.max(30, Math.floor(raw)));
  }

  private get embedTtlSeconds(): number {
    const raw = Number(
      this.configService.get<string>('RAG_EMBED_CACHE_TTL_SECONDS') ?? 3600,
    );
    if (!Number.isFinite(raw)) return 3600;
    return Math.min(86_400, Math.max(60, Math.floor(raw)));
  }

  async getEmbedding(
    model: string,
    query: string,
  ): Promise<number[] | null> {
    if (!this.enabled) return null;
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return null;
      const key = `rag:embed:${hashQueryKey([model, query])}`;
      const raw = await redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async setEmbedding(
    model: string,
    query: string,
    embedding: number[],
  ): Promise<void> {
    if (!this.enabled || !embedding.length) return;
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return;
      const key = `rag:embed:${hashQueryKey([model, query])}`;
      await redis.set(
        key,
        JSON.stringify(embedding),
        'EX',
        this.embedTtlSeconds,
      );
    } catch (error) {
      this.logger.debug(
        `写 embedding 缓存失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getRetrievalResult(
    input: RetrievalCacheKeyInput,
  ): Promise<CachedRetrievalResult | null> {
    if (!this.enabled) return null;
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return null;
      const key = this.retrievalKey(input);
      const raw = await redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      // 兼容已写入的旧数组格式；下一次 miss 后会自动升级为对象格式。
      if (Array.isArray(parsed)) {
        return { chunks: parsed as KnowledgeChunk[] };
      }
      if (!parsed || typeof parsed !== 'object') return null;
      const value = parsed as Partial<CachedRetrievalResult>;
      if (!Array.isArray(value.chunks)) return null;
      return {
        chunks: value.chunks,
        knowledgeCount: this.toOptionalNonNegativeInteger(value.knowledgeCount),
        rerankLimit: this.toOptionalNonNegativeInteger(value.rerankLimit),
      };
    } catch {
      return null;
    }
  }

  async setRetrievalResult(
    input: RetrievalCacheKeyInput & CachedRetrievalResult,
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return;
      const key = this.retrievalKey(input);
      await redis.set(
        key,
        JSON.stringify({
          chunks: input.chunks,
          knowledgeCount: input.knowledgeCount,
          rerankLimit: input.rerankLimit,
        } satisfies CachedRetrievalResult),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.debug(
        `写 retrieval 缓存失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 保留旧接口，供尚未升级的调用方平滑迁移。 */
  async getRetrievalChunks(
    input: RetrievalCacheKeyInput,
  ): Promise<KnowledgeChunk[] | null> {
    return (await this.getRetrievalResult(input))?.chunks ?? null;
  }

  /** 保留旧接口，供尚未升级的调用方平滑迁移。 */
  async setRetrievalChunks(
    input: RetrievalCacheKeyInput & { chunks: KnowledgeChunk[] },
  ): Promise<void> {
    await this.setRetrievalResult(input);
  }

  private toOptionalNonNegativeInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private retrievalKey(input: RetrievalCacheKeyInput): string {
    return [
      'rag:ret',
      input.profileId || 'default',
      input.personaId || input.scopeKey || 'none',
      hashAclSnapshot(input.aclSnapshot),
      hashQueryKey(input.queryKeyParts),
    ].join(':');
  }
}
