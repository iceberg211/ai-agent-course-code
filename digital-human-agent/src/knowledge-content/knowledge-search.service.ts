import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/knowledge-content-runtime.service';
import type {
  KnowledgeChunk,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
} from '@/knowledge-content/knowledge-content.types';
import { RerankerService } from '@/knowledge-content/reranker.service';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly rerankerService: RerankerService,
  ) {}

  async retrieve(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    try {
      const result = await this.retrieveWithStages(knowledgeId, query, options);
      return result.stage2;
    } catch (error) {
      this.logger.warn(
        `知识检索失败（knowledge=${knowledgeId}），降级为空知识：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  async retrieveWithStages(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    const normalizedQuery = query.trim();
    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);

    if (!normalizedQuery) {
      return {
        query: normalizedQuery,
        options: normalizedOptions,
        stage1: [],
        stage2: [],
      };
    }

    const queryEmbedding = await this.runtime.withTransientRetry(
      'embed query',
      () => this.runtime.embeddings.embedQuery(normalizedQuery),
      3,
    );

    const stage1 = await this.retrieveStage1(
      knowledgeId,
      queryEmbedding,
      normalizedOptions.threshold,
      normalizedOptions.stage1TopK,
    );

    let stage2 = stage1.slice(0, normalizedOptions.finalTopK);
    if (normalizedOptions.rerank && stage1.length > 1) {
      try {
        stage2 = await this.rerankerService.rerank(
          normalizedQuery,
          stage1,
          normalizedOptions.finalTopK,
        );
      } catch (error) {
        this.logger.warn(
          `Reranker 失败，回退为向量检索结果：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      query: normalizedQuery,
      options: normalizedOptions,
      stage1,
      stage2,
    };
  }

  async retrieveForPersona(
    personaId: string,
    query: string,
  ): Promise<KnowledgeChunk[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const knowledgeConfigs = await this.listMountedKnowledgeConfigs(personaId);
    if (knowledgeConfigs.length === 0) return [];

    const queryEmbedding = await this.runtime.withTransientRetry(
      'embed query',
      () => this.runtime.embeddings.embedQuery(normalizedQuery),
      3,
    );

    const stage1Results = await Promise.all(
      knowledgeConfigs.map(async (config) => {
        try {
          return await this.retrieveStage1(
            config.knowledgeId,
            queryEmbedding,
            config.threshold,
            config.stage1TopK,
          );
        } catch (error) {
          this.logger.warn(
            `stage1 失败（knowledge=${config.knowledgeId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [] as KnowledgeChunk[];
        }
      }),
    );

    const mergedStage1 = this.mergeStage1Results(
      stage1Results,
      knowledgeConfigs,
    );
    if (mergedStage1.length <= 1) {
      return mergedStage1;
    }

    try {
      return await this.rerankerService.rerank(normalizedQuery, mergedStage1, 5);
    } catch (error) {
      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return mergedStage1.slice(0, 5);
    }
  }

  private async listMountedKnowledgeConfigs(personaId: string): Promise<
    Array<{ knowledgeId: string; threshold: number; stage1TopK: number }>
  > {
    const { data: mounts, error: mountError } = await this.runtime.supabase
      .from('persona_knowledge_base')
      .select('knowledge_base_id')
      .eq('persona_id', personaId);

    if (mountError) {
      this.logger.warn(`查询 persona ${personaId} 挂载失败：${mountError.message}`);
      return [];
    }

    if (!mounts || mounts.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
    }

    const knowledgeIds = mounts.map((item) => item.knowledge_base_id as string);
    const { data: knowledgeRows, error: knowledgeError } = await this.runtime.supabase
      .from('knowledge_base')
      .select('id, retrieval_config')
      .in('id', knowledgeIds);

    if (knowledgeError || !knowledgeRows || knowledgeRows.length === 0) {
      if (knowledgeError) {
        this.logger.warn(`查询知识库配置失败：${knowledgeError.message}`);
      }
      return [];
    }

    return knowledgeRows.map((knowledge) => {
      const config =
        (knowledge.retrieval_config as Partial<KnowledgeRetrievalConfig>) ?? {};

      return {
        knowledgeId: knowledge.id as string,
        threshold: this.runtime.toBoundedNumber(config.threshold, 0.6, 0, 1),
        stage1TopK: this.runtime.toBoundedNumber(config.stage1TopK, 20, 1, 50),
      };
    });
  }

  private mergeStage1Results(
    stage1Results: KnowledgeChunk[][],
    knowledgeConfigs: Array<{ stage1TopK: number }>,
  ): KnowledgeChunk[] {
    const dedupedChunks = new Map<string, KnowledgeChunk>();

    for (const chunks of stage1Results) {
      for (const chunk of chunks) {
        const current = dedupedChunks.get(chunk.id);
        if (!current || (chunk.similarity ?? 0) > (current.similarity ?? 0)) {
          dedupedChunks.set(chunk.id, chunk);
        }
      }
    }

    const sortedChunks = Array.from(dedupedChunks.values()).sort(
      (left, right) => (right.similarity ?? 0) - (left.similarity ?? 0),
    );

    const globalStage1TopK = Math.max(
      20,
      ...knowledgeConfigs.map((config) => config.stage1TopK),
    );

    return sortedChunks.slice(0, globalStage1TopK);
  }

  private async retrieveStage1(
    knowledgeId: string,
    queryEmbedding: number[],
    threshold: number,
    matchCount: number,
  ): Promise<KnowledgeChunk[]> {
    const { data, error } = await this.runtime.withTransientRetry<{
      data: KnowledgeChunk[] | null;
      error: { message: string } | null;
    }>(
      'match_knowledge rpc',
      async () => {
        const result = await this.runtime.supabase.rpc('match_knowledge', {
          query_embedding: queryEmbedding,
          p_kb_id: knowledgeId,
          match_threshold: threshold,
          match_count: matchCount,
        });

        return {
          data: (result.data as KnowledgeChunk[] | null) ?? null,
          error: result.error ? { message: result.error.message } : null,
        };
      },
      3,
    );

    if (error) {
      throw new Error(error.message);
    }

    return data ?? [];
  }
}
