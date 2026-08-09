import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MemoryRecordEntity } from '@/memory/entities/memory-record.entity';
import type {
  AddMemoryInput,
  DeleteMemoryInput,
  LongTermMemoryProvider,
  MemoryRecord,
  SearchMemoryInput,
} from '@/memory/memory.types';

@Injectable()
export class LocalLongTermMemoryProvider implements LongTermMemoryProvider {
  constructor(
    @InjectRepository(MemoryRecordEntity)
    private readonly memoryRepo: Repository<MemoryRecordEntity>,
  ) {}

  async add(input: AddMemoryInput): Promise<MemoryRecord> {
    const content = input.content.trim();
    if (!content) {
      throw new Error('长期记忆内容不能为空');
    }

    const record = this.memoryRepo.create({
      ownerId: input.ownerId,
      department: input.department ?? null,
      visibility: input.visibility ?? 'private',
      category: input.category ?? 'preference',
      content,
      sourceConversationId: input.sourceConversationId ?? null,
      confidence: clampConfidence(input.confidence),
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? null,
    });
    return this.memoryRepo.save(record);
  }

  async search(input: SearchMemoryInput): Promise<MemoryRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const now = new Date();
    const qb = this.memoryRepo
      .createQueryBuilder('memory')
      .where(
        new Brackets((where) => {
          where.where('memory.expires_at IS NULL').orWhere(
            'memory.expires_at > :now',
            { now },
          );
        }),
      )
      .orderBy('memory.confidence', 'DESC')
      .addOrderBy('memory.updated_at', 'DESC')
      .take(limit);

    if (input.ownerId || input.department) {
      qb.andWhere(
        new Brackets((where) => {
          if (input.ownerId) {
            where.orWhere(
              'memory.owner_id = :ownerId AND memory.visibility = :privateVisibility',
              {
                ownerId: input.ownerId,
                privateVisibility: 'private',
              },
            );
          }
          if (input.department) {
            where.orWhere(
              'memory.department = :department AND memory.visibility = :departmentVisibility',
              {
                department: input.department,
                departmentVisibility: 'department',
              },
            );
          }
          where.orWhere('memory.visibility = :companyVisibility', {
            companyVisibility: 'company',
          });
        }),
      );
    } else {
      qb.andWhere('memory.visibility = :companyVisibility', {
        companyVisibility: 'company',
      });
    }

    const query = String(input.query ?? '').trim();
    if (query) {
      const terms = query
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 5);
      if (terms.length > 0) {
        qb.andWhere(
          new Brackets((where) => {
            terms.forEach((term, index) => {
              where.orWhere(`memory.content ILIKE :term${index}`, {
                [`term${index}`]: `%${term}%`,
              });
            });
          }),
        );
      }
    }

    return qb.getMany();
  }

  async delete(input: DeleteMemoryInput): Promise<void> {
    if (input.ownerId) {
      await this.memoryRepo.delete({ id: input.id, ownerId: input.ownerId });
      return;
    }
    await this.memoryRepo.delete({ id: input.id });
  }
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.7;
  return Math.min(1, Math.max(0, parsed));
}
