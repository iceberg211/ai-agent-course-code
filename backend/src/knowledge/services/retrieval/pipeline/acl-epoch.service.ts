import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { RedisService } from '@/common/redis/redis.service';

/**
 * per-KB ACL epoch：
 * - 优先 Redis `kb:{id}:acl_epoch`（ACL 刷新时 bump）
 * - 回退 DB max(acl_version)
 */
@Injectable()
export class AclEpochService {
  private readonly logger = new Logger(AclEpochService.name);

  constructor(
    private readonly redisService: RedisService,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
  ) {}

  private key(knowledgeBaseId: string): string {
    return `kb:${knowledgeBaseId}:acl_epoch`;
  }

  async getEpoch(knowledgeBaseId: string): Promise<number> {
    if (!knowledgeBaseId) return 0;
    try {
      const redis = await this.redisService.ensureConnected();
      if (redis) {
        const cached = await redis.get(this.key(knowledgeBaseId));
        if (cached && Number.isFinite(Number(cached))) {
          return Number(cached);
        }
      }
    } catch (error) {
      this.logger.debug(
        `读取 acl epoch 失败，回退 DB：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const row = await this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin('chunk.document', 'document')
      .select('MAX(chunk.acl_version)', 'maxVersion')
      .where('document.knowledge_base_id = :kbId', { kbId: knowledgeBaseId })
      .getRawOne<{ maxVersion: string | null }>();
    const fromDb = Number(row?.maxVersion ?? 1);
    const epoch = Number.isFinite(fromDb) ? fromDb : 1;
    await this.setEpoch(knowledgeBaseId, epoch);
    return epoch;
  }

  async getEpochs(knowledgeBaseIds: string[]): Promise<Record<string, number>> {
    const unique = Array.from(new Set(knowledgeBaseIds.filter(Boolean)));
    const result: Record<string, number> = {};
    await Promise.all(
      unique.map(async (id) => {
        result[id] = await this.getEpoch(id);
      }),
    );
    return result;
  }

  async bumpEpoch(knowledgeBaseId: string): Promise<number> {
    if (!knowledgeBaseId) return 0;
    const next = Date.now();
    await this.setEpoch(knowledgeBaseId, next);
    return next;
  }

  async bumpEpochForDocument(documentId: string): Promise<void> {
    if (!documentId) return;
    const row = await this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin('chunk.document', 'document')
      .select('document.knowledge_base_id', 'kbId')
      .where('chunk.document_id = :documentId', { documentId })
      .limit(1)
      .getRawOne<{ kbId: string }>();
    if (row?.kbId) {
      await this.bumpEpoch(row.kbId);
    }
  }

  private async setEpoch(knowledgeBaseId: string, epoch: number): Promise<void> {
    try {
      const redis = await this.redisService.ensureConnected();
      if (!redis) return;
      await redis.set(this.key(knowledgeBaseId), String(epoch));
    } catch (error) {
      this.logger.debug(
        `写入 acl epoch 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
