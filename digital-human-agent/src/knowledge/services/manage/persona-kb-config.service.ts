import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Knowledge, KnowledgeRetrievalConfig } from '@/knowledge/entities/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/entities/persona-knowledge.entity';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
import {
  DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG,
  THRESHOLD_MIN,
  THRESHOLD_MAX,
  RETRIEVAL_LIMIT_MAX,
} from '@/common/constants/knowledge.constants';
import type {
  MountedKnowledgeConfig,
} from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class PersonaKbConfigService {
  private readonly logger = new Logger(PersonaKbConfigService.name);

  private static readonly DB_RETRY_ATTEMPTS = 3;

  constructor(
    private readonly runtime: RagRuntimeService,
    @InjectRepository(PersonaKnowledge)
    private readonly personaKnowledgeRepo: Repository<PersonaKnowledge>,
    @InjectRepository(Knowledge)
    private readonly knowledgeRepo: Repository<Knowledge>,
  ) {}

  async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<MountedKnowledgeConfig[]> {
    // 单条 JOIN 查询替代原先的两次独立查询，减少一次数据库往返
    const knowledgeRows = await this.runtime.withTransientRetry(
      `查询 persona ${personaId} 挂载知识库配置`,
      () =>
        this.knowledgeRepo
          .createQueryBuilder('kb')
          .innerJoin(
            PersonaKnowledge,
            'pk',
            'pk.knowledgeBaseId = kb.id',
          )
          .where('pk.personaId = :personaId', { personaId })
          .select(['kb.id', 'kb.retrievalConfig', 'kb.updatedAt'])
          .getMany(),
      PersonaKbConfigService.DB_RETRY_ATTEMPTS,
    );

    if (!knowledgeRows || knowledgeRows.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
    }

    return knowledgeRows.map((knowledge) => {
      const config =
        (knowledge.retrievalConfig as Partial<KnowledgeRetrievalConfig>) ?? {};

      return {
        knowledgeId: knowledge.id,
        threshold: this.runtime.toBoundedNumber(
          config.threshold,
          DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.threshold,
          THRESHOLD_MIN,
          THRESHOLD_MAX,
        ),
        retrievalLimit: this.runtime.toBoundedNumber(
          config.retrievalLimit,
          DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.retrievalLimit,
          1,
          RETRIEVAL_LIMIT_MAX,
        ),
        retrievalConfig: config,
        updatedAt: knowledge.updatedAt
          ? knowledge.updatedAt.toISOString()
          : null,
      };
    });
  }
}
