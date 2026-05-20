import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Knowledge, KnowledgeRetrievalConfig } from '@/knowledge/entities/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/entities/persona-knowledge.entity';
import { KnowledgeContentRuntimeService } from '@/knowledge/services/manage/knowledge-content-runtime.service';
import type {
  MountedKnowledgeConfig,
} from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class PersonaKnowledgeConfigService {
  private readonly logger = new Logger(PersonaKnowledgeConfigService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    @InjectRepository(PersonaKnowledge)
    private readonly personaKnowledgeRepo: Repository<PersonaKnowledge>,
    @InjectRepository(Knowledge)
    private readonly knowledgeRepo: Repository<Knowledge>,
  ) {}

  async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<MountedKnowledgeConfig[]> {
    const mounts = await this.runtime.withTransientRetry(
      `查询 persona ${personaId} 挂载知识库`,
      () =>
        this.personaKnowledgeRepo.find({
          where: { personaId },
          select: ['knowledgeBaseId'],
        }),
      3,
    );

    if (!mounts || mounts.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
    }

    const knowledgeIds = mounts.map((item) => item.knowledgeBaseId);
    const knowledgeRows = await this.runtime.withTransientRetry(
      '查询已挂载知识库配置',
      () =>
        this.knowledgeRepo.find({
          where: { id: In(knowledgeIds) },
          select: ['id', 'retrievalConfig', 'updatedAt'],
        }),
      3,
    );

    if (!knowledgeRows || knowledgeRows.length === 0) {
      return [];
    }

    return knowledgeRows.map((knowledge) => {
      const config =
        (knowledge.retrievalConfig as Partial<KnowledgeRetrievalConfig>) ?? {};

      return {
        knowledgeId: knowledge.id,
        threshold: this.runtime.toBoundedNumber(config.threshold, 0.6, 0, 1),
        retrievalLimit: this.runtime.toBoundedNumber(
          config.retrievalLimit ?? config.stage1TopK,
          20,
          1,
          50,
        ),
        retrievalConfig: config,
        updatedAt: knowledge.updatedAt
          ? knowledge.updatedAt.toISOString()
          : null,
      };
    });
  }
}

