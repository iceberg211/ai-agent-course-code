import { Injectable, Logger } from '@nestjs/common';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type {
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  RetrieveKnowledgeDebugResult,
  RetrieveKnowledgeOptions,
} from '@/knowledge-content/types/knowledge-content.types';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';
import type { HybridRetrieveResult } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly hybridRetriever: KnowledgeHybridRetrieverService,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
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
    return runInTracedScope(
      {
        name: 'knowledge_retrieve_with_stages',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'single-kb'],
        metadata: {
          knowledgeId,
        },
        input: {
          knowledgeId,
          query,
          rerank: options.rerank,
          stage1TopK: options.stage1TopK,
          finalTopK: options.finalTopK,
          threshold: options.threshold,
        },
        outputProcessor: (output) => ({
          query: output.query,
          retrievalQuery: output.retrievalQuery,
          stage1Count: output.stage1.length,
          stage2Count: output.stage2.length,
        }),
      },
      () => this.retrieveWithStagesInternal(knowledgeId, query, options),
    );
  }

  private async retrieveWithStagesInternal(
    knowledgeId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    const normalizedQuery = query.trim();
    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);

    if (!normalizedQuery) {
      const fallbackRewrite = this.buildFallbackRewrite(
        normalizedQuery,
        '原始问题为空，跳过改写',
      );
      return {
        query: normalizedQuery,
        retrievalQuery: normalizedQuery,
        rewrite: fallbackRewrite,
        options: normalizedOptions,
        stage1: [],
        stage2: [],
      };
    }

    const rewrite = await this.resolveRetrievalQuery(normalizedQuery);
    const retrievalQuery = rewrite.rewrittenQuery;

    const queryEmbedding = await this.runtime.withTransientRetry(
      'embed query',
      () => this.runtime.embeddings.embedQuery(retrievalQuery),
      3,
    );

    const stage1Result = await this.retrieveStage1(
      knowledgeId,
      queryEmbedding,
      retrievalQuery,
      rewrite.keywords,
      normalizedOptions.threshold,
      normalizedOptions.stage1TopK,
    );
    const stage1 = stage1Result.chunks;

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
      retrievalQuery,
      rewrite,
      options: normalizedOptions,
      stage1,
      stage2,
    };
  }

  async retrieveForPersona(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    return runInTracedScope(
      {
        name: 'persona_knowledge_retrieve',
        runType: 'chain',
        tags: ['knowledge', 'rag', 'retrieve', 'persona'],
        metadata: {
          personaId,
        },
        input: {
          personaId,
          query,
          rerank: options.rerank,
          stage1TopK: options.stage1TopK,
          finalTopK: options.finalTopK,
          threshold: options.threshold,
        },
        outputProcessor: (output) => ({
          resultCount: output.length,
        }),
      },
      () => this.retrieveForPersonaInternal(personaId, query, options),
    );
  }

  private async retrieveForPersonaInternal(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const normalizedOptions = this.runtime.normalizeRetrieveOptions(options);
    const knowledgeConfigs = await this.listMountedKnowledgeConfigs(personaId);
    if (knowledgeConfigs.length === 0) return [];

    const rewrite = await this.resolveRetrievalQuery(normalizedQuery);

    const queryEmbedding = await this.runtime.withTransientRetry(
      'embed query',
      () => this.runtime.embeddings.embedQuery(rewrite.rewrittenQuery),
      3,
    );

    const stage1Results = await Promise.all(
      knowledgeConfigs.map(async (config) => {
        try {
          const effectiveThreshold =
            options.threshold === undefined
              ? config.threshold
              : normalizedOptions.threshold;
          const effectiveStage1TopK =
            options.stage1TopK === undefined
              ? config.stage1TopK
              : normalizedOptions.stage1TopK;
          const stage1Result = await this.retrieveStage1(
            config.knowledgeId,
            queryEmbedding,
            rewrite.rewrittenQuery,
            rewrite.keywords,
            effectiveThreshold,
            effectiveStage1TopK,
          );
          return stage1Result.chunks;
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
      options.stage1TopK === undefined
        ? Math.max(20, ...knowledgeConfigs.map((config) => config.stage1TopK))
        : normalizedOptions.stage1TopK,
    );
    if (mergedStage1.length <= 1 || !normalizedOptions.rerank) {
      return mergedStage1.slice(0, normalizedOptions.finalTopK);
    }

    try {
      return await this.rerankerService.rerank(
        normalizedQuery,
        mergedStage1,
        normalizedOptions.finalTopK,
      );
    } catch (error) {
      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return mergedStage1.slice(0, normalizedOptions.finalTopK);
    }
  }

  private async listMountedKnowledgeConfigs(
    personaId: string,
  ): Promise<
    Array<{ knowledgeId: string; threshold: number; stage1TopK: number }>
  > {
    const { data: mounts, error: mountError } = await this.runtime.supabase
      .from('persona_knowledge_base')
      .select('knowledge_base_id')
      .eq('persona_id', personaId);

    if (mountError) {
      this.logger.warn(
        `查询 persona ${personaId} 挂载失败：${mountError.message}`,
      );
      return [];
    }

    if (!mounts || mounts.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
    }

    const knowledgeIds = mounts.map((item) => item.knowledge_base_id as string);
    const { data: knowledgeRows, error: knowledgeError } =
      await this.runtime.supabase
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
    globalStage1TopK: number,
  ): KnowledgeChunk[] {
    const dedupedChunks = new Map<string, KnowledgeChunk>();

    for (const chunks of stage1Results) {
      for (const chunk of chunks) {
        const current = dedupedChunks.get(chunk.id);
        if (!current || this.compareRetrievalChunks(chunk, current) > 0) {
          dedupedChunks.set(chunk.id, chunk);
        }
      }
    }

    const sortedChunks = Array.from(dedupedChunks.values()).sort(
      (left, right) => this.compareRetrievalChunks(right, left),
    );

    return sortedChunks.slice(0, globalStage1TopK);
  }

  private async resolveRetrievalQuery(
    query: string,
  ): Promise<KnowledgeQueryRewriteResult> {
    return this.queryRewriteService.rewrite(query);
  }

  private buildFallbackRewrite(
    query: string,
    reason: string,
  ): KnowledgeQueryRewriteResult {
    return {
      originalQuery: query,
      rewrittenQuery: query,
      keywords: [query],
      changed: false,
      reason,
    };
  }

  private async retrieveStage1(
    knowledgeId: string,
    queryEmbedding: number[],
    retrievalQuery: string,
    keywordTerms: string[],
    threshold: number,
    matchCount: number,
  ): Promise<HybridRetrieveResult> {
    return this.hybridRetriever.retrieve({
      knowledgeId,
      queryEmbedding,
      retrievalQuery,
      keywordTerms,
      threshold,
      matchCount,
    });
  }

  private compareRetrievalChunks(
    left: KnowledgeChunk,
    right: KnowledgeChunk,
  ): number {
    return (
      (left.hybrid_score ?? 0) - (right.hybrid_score ?? 0) ||
      (left.keyword_score ?? 0) - (right.keyword_score ?? 0) ||
      (left.similarity ?? 0) - (right.similarity ?? 0)
    );
  }
}
