import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type {
  MountedKnowledgeConfig,
} from '@/knowledge-content/types/knowledge-content.types';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

@Injectable()
export class PersonaKnowledgeConfigService {
  private readonly logger = new Logger(PersonaKnowledgeConfigService.name);

  constructor(private readonly runtime: KnowledgeContentRuntimeService) {}

  async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<MountedKnowledgeConfig[]> {
    const { data: mounts } = await this.runtime.withTransientRetry(
      `查询 persona ${personaId} 挂载知识库`,
      async () => {
        const result = await this.runtime.supabase
          .from('persona_knowledge_base')
          .select('knowledge_base_id')
          .eq('persona_id', personaId);
        if (result.error) {
          throw this.createSupabaseQueryError(
            `查询 persona ${personaId} 挂载失败`,
            result.error,
          );
        }
        return result;
      },
      3,
    );

    if (!mounts || mounts.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
    }

    const knowledgeIds = mounts.map((item) => item.knowledge_base_id as string);
    const { data: knowledgeRows } = await this.runtime.withTransientRetry(
      '查询已挂载知识库配置',
      async () => {
        const result = await this.runtime.supabase
          .from('knowledge_base')
          .select('id, retrieval_config, updated_at')
          .in('id', knowledgeIds);
        if (result.error) {
          throw this.createSupabaseQueryError(
            '查询知识库配置失败',
            result.error,
          );
        }
        return result;
      },
      3,
    );

    if (!knowledgeRows || knowledgeRows.length === 0) {
      return [];
    }

    return knowledgeRows.map((knowledge) => {
      const config =
        (knowledge.retrieval_config as Partial<KnowledgeRetrievalConfig>) ?? {};

      return {
        knowledgeId: knowledge.id as string,
        threshold: this.runtime.toBoundedNumber(config.threshold, 0.6, 0, 1),
        stage1TopK: this.runtime.toBoundedNumber(config.stage1TopK, 20, 1, 50),
        retrievalConfig: config,
        updatedAt:
          typeof knowledge.updated_at === 'string'
            ? knowledge.updated_at
            : null,
      };
    });
  }

  private createSupabaseQueryError(
    message: string,
    error: { message?: string; code?: string },
  ): Error {
    const suffix = [error.code, error.message].filter(Boolean).join(' ');
    return new Error(suffix ? `${message}: ${suffix}` : message);
  }
}
