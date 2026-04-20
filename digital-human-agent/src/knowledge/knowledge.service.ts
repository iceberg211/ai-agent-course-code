import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk as KnowledgeChunkEntity } from './knowledge-chunk.entity';
import type { KnowledgeBaseRetrievalConfig } from '../knowledge-base/knowledge-base.entity';
import { RerankerService } from './reranker.service';
import type {
  RagDebugTrace,
  RagStageTrace,
  RerankTrace,
  RetrievalHit,
  RetrievalRankStage,
} from './rag-debug.types';
import {
  QueryRewriteService,
  type QueryRewriteMessage,
  type QueryRewriteResult,
} from './query-rewrite.service';

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  similarity: number;
  knowledge_base_id?: string;
  rerank_score?: number;
}

export interface RetrieveKnowledgeOptions {
  retrievalMode?: KnowledgeBaseRetrievalConfig['retrievalMode'];
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  vectorTopK?: number;
  keywordTopK?: number;
  finalTopK?: number;
  fusion?: Partial<KnowledgeBaseRetrievalConfig['fusion']>;
  rewrite?: boolean;
  history?: QueryRewriteMessage[];
}

interface NormalizedRetrieveOptions {
  retrievalMode: KnowledgeBaseRetrievalConfig['retrievalMode'];
  threshold: number;
  rerank: boolean;
  stage1TopK: number;
  vectorTopK: number;
  keywordTopK: number;
  finalTopK: number;
  fusion: KnowledgeBaseRetrievalConfig['fusion'];
  rewrite: boolean;
}

export interface RetrieveKnowledgeDebugResult {
  query: string;
  options: NormalizedRetrieveOptions;
  stage1: KnowledgeChunk[];
  stage2: KnowledgeChunk[];
  debugTrace: RagDebugTrace;
}

export interface RetrievePersonaDebugResult {
  query: string;
  results: KnowledgeChunk[];
  debugTrace: RagDebugTrace;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly embeddingBatchSize = this.toNumber(
    process.env.EMBEDDINGS_BATCH_SIZE,
    10,
    1,
    10,
  );
  private readonly embeddings = new OpenAIEmbeddings({
    model: process.env.EMBEDDINGS_MODEL_NAME ?? 'text-embedding-v3',
    batchSize: this.embeddingBatchSize,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ['\n\n', '\n', '。', '！', '？', '；', '，', ' '],
  });

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
  ) {}

  async deleteDocument(documentId: string): Promise<void> {
    // knowledge_chunk.document_id 的 ON DELETE CASCADE 会级联删 chunks + embedding
    await this.docRepo.delete(documentId);
  }

  private isTransientError(error: unknown): boolean {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';
    return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|502|503|504|429/i.test(
      msg,
    );
  }

  private async withTransientRetry<T>(
    op: string,
    fn: () => Promise<T>,
    attempts = 2,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isTransientError(error) || i === attempts) {
          break;
        }
        this.logger.warn(
          `${op} 第 ${i} 次失败，准备重试：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * i));
      }
    }
    throw lastError;
  }

  private normalizeRetrieveOptions(
    options: RetrieveKnowledgeOptions,
  ): NormalizedRetrieveOptions {
    const finalTopK = this.toNumber(options.finalTopK, 5, 1, 20);
    const rerank = options.rerank !== false;
    const stage1Default = rerank ? Math.max(20, finalTopK) : finalTopK;
    const vectorTopK = this.toNumber(
      options.vectorTopK ?? options.stage1TopK,
      stage1Default,
      finalTopK,
      50,
    );
    const keywordTopK = this.toNumber(options.keywordTopK, 20, 1, 50);
    const threshold = this.toNumber(options.threshold, 0.6, 0, 1);

    return {
      retrievalMode: this.normalizeRetrievalMode(options.retrievalMode),
      threshold,
      rerank,
      stage1TopK: vectorTopK,
      vectorTopK,
      keywordTopK,
      finalTopK,
      fusion: {
        method: 'rrf',
        rrfK: this.toNumber(options.fusion?.rrfK, 60, 1, 200),
        vectorWeight: this.toNumber(options.fusion?.vectorWeight, 1, 0, 10),
        keywordWeight: this.toNumber(options.fusion?.keywordWeight, 1, 0, 10),
      },
      rewrite: options.rewrite === true,
    };
  }

  private normalizeRetrievalMode(
    value: RetrieveKnowledgeOptions['retrievalMode'],
  ): KnowledgeBaseRetrievalConfig['retrievalMode'] {
    if (value === 'keyword' || value === 'hybrid') return value;
    return 'vector';
  }

  private toNumber(
    raw: unknown,
    defaultValue: number,
    min: number,
    max: number,
  ): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return defaultValue;
    return Math.min(max, Math.max(min, n));
  }

  // ========================================================================
  // kb-id based retrieval + persona aggregation.
  // ========================================================================

  async retrieve(
    kbId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    try {
      const result = await this.retrieveWithStages(kbId, query, options);
      return result.stage2;
    } catch (error) {
      this.logger.warn(
        `知识检索失败（kb=${kbId}），降级为空知识：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  async retrieveWithStages(
    kbId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    const startedAt = Date.now();
    const normalizedQuery = query.trim();
    const normalizedOptions = this.normalizeRetrieveOptions(options);

    if (!normalizedQuery) {
      const debugTrace = this.createDebugTrace({
        chainType: 'kb_hit_test',
        knowledgeBaseIds: [kbId],
        originalQuery: normalizedQuery,
        hits: [],
        timingsMs: { total: Date.now() - startedAt },
        stages: [
          {
            name: 'vector_retrieval',
            skipped: true,
            skipReason: 'empty_query',
          },
          this.createSkippedStage('keyword_retrieval', 'not_implemented_in_p0'),
          this.createSkippedStage('fusion', 'not_implemented_in_p0'),
          this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
          this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
        ],
        lowConfidence: true,
        lowConfidenceReason: 'empty_query',
      });
      return {
        query: normalizedQuery,
        options: normalizedOptions,
        stage1: [],
        stage2: [],
        debugTrace,
      };
    }

    const timingsMs: Record<string, number> = {};
    const rewrite = await this.rewriteQuery(normalizedQuery, options);
    const retrievalQuery = rewrite.query;
    if (rewrite.latencyMs !== undefined) {
      timingsMs.queryRewrite = rewrite.latencyMs;
    }

    const queryEmbedding = await this.withTransientRetry(
      'embed query',
      async () => {
        const embedStartedAt = Date.now();
        const embedding = await this.embeddings.embedQuery(retrievalQuery);
        timingsMs.embedQuery = Date.now() - embedStartedAt;
        return embedding;
      },
      3,
    );

    const vectorStartedAt = Date.now();
    const stage1 = await this.retrieveStage1(
      kbId,
      queryEmbedding,
      normalizedOptions.threshold,
      normalizedOptions.stage1TopK,
    );
    timingsMs.vectorRetrieval = Date.now() - vectorStartedAt;

    let stage2 = stage1.slice(0, normalizedOptions.finalTopK);
    let rerankTrace: RerankTrace | undefined;
    let rankStage: RetrievalRankStage = 'raw';
    const rerankStage: RagStageTrace = {
      name: 'rerank',
      input: {
        enabled: normalizedOptions.rerank,
        candidateCount: stage1.length,
        finalTopK: normalizedOptions.finalTopK,
      },
    };
    if (normalizedOptions.rerank && stage1.length > 1) {
      const rerankStartedAt = Date.now();
      try {
        stage2 = await this.rerankerService.rerank(
          retrievalQuery,
          stage1,
          normalizedOptions.finalTopK,
        );
        timingsMs.rerank = Date.now() - rerankStartedAt;
        rankStage = 'rerank';
        rerankTrace = this.createRerankTrace(stage1, stage2, true);
        rerankStage.output = {
          hitCount: stage2.length,
          hits: stage2.map((chunk, index) =>
            this.toRetrievalHit(chunk, index + 1, 'rerank'),
          ),
        };
        rerankStage.latencyMs = timingsMs.rerank;
      } catch (error) {
        timingsMs.rerank = Date.now() - rerankStartedAt;
        rerankTrace = this.createRerankTrace(stage1, stage2, true);
        rerankStage.skipped = true;
        rerankStage.skipReason = 'rerank_failed';
        rerankStage.output = {
          error: error instanceof Error ? error.message : String(error),
          fallbackHitCount: stage2.length,
        };
        rerankStage.latencyMs = timingsMs.rerank;
        this.logger.warn(
          `Reranker 失败，回退为向量检索结果：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      rerankTrace = this.createRerankTrace(
        stage1,
        stage2,
        normalizedOptions.rerank,
      );
      rerankStage.skipped = true;
      rerankStage.skipReason = normalizedOptions.rerank
        ? 'not_enough_candidates'
        : 'disabled';
      rerankStage.output = {
        hitCount: stage2.length,
      };
    }

    const finalHits = stage2.map((chunk, index) =>
      this.toRetrievalHit(chunk, index + 1, rankStage),
    );
    const confidence = this.assessLowConfidence(
      stage2,
      normalizedOptions.threshold,
    );
    timingsMs.total = Date.now() - startedAt;

    const debugTrace = this.createDebugTrace({
      chainType: 'kb_hit_test',
      knowledgeBaseIds: [kbId],
      originalQuery: normalizedQuery,
      rewrittenQuery: retrievalQuery,
      retrievalMode: 'vector',
      hits: finalHits,
      rerank: rerankTrace,
      timingsMs,
      lowConfidence: confidence.lowConfidence,
      lowConfidenceReason: confidence.reason,
      stages: [
        rewrite.stage,
        {
          name: 'vector_retrieval',
          input: {
            knowledgeBaseId: kbId,
            threshold: normalizedOptions.threshold,
            requestedMode: normalizedOptions.retrievalMode,
            vectorTopK: normalizedOptions.vectorTopK,
            keywordTopK: normalizedOptions.keywordTopK,
            fusion: normalizedOptions.fusion,
            topK: normalizedOptions.vectorTopK,
          },
          output: {
            hitCount: stage1.length,
            hits: stage1.map((chunk, index) =>
              this.toRetrievalHit(chunk, index + 1, 'raw'),
            ),
          },
          latencyMs: timingsMs.vectorRetrieval,
        },
        this.createSkippedStage('keyword_retrieval', 'not_implemented_in_p0'),
        this.createSkippedStage('fusion', 'not_implemented_in_p0'),
        rerankStage,
        this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
        this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
      ],
    });

    return {
      query: normalizedQuery,
      options: normalizedOptions,
      stage1,
      stage2,
      debugTrace,
    };
  }

  /**
   * persona 聚合检索：查 persona 挂载的所有 KB，各自按 retrievalConfig 并发 stage1，
   * 合并去重后统一 rerank。
   *
   * Stage1 参数（threshold / stage1TopK）按每个 KB 独立生效；
   * Stage2 的 rerank / finalTopK 使用全局兜底值（5）。
   */
  async retrieveForPersona(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    const result = await this.retrieveForPersonaWithTrace(
      personaId,
      query,
      options,
    );
    return result.results;
  }

  async retrieveForPersonaWithTrace(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrievePersonaDebugResult> {
    const startedAt = Date.now();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        query: normalizedQuery,
        results: [],
        debugTrace: this.createDebugTrace({
          chainType: 'persona_retrieval',
          personaId,
          knowledgeBaseIds: [],
          originalQuery: normalizedQuery,
          hits: [],
          timingsMs: { total: Date.now() - startedAt },
          stages: [
            {
              name: 'vector_retrieval',
              skipped: true,
              skipReason: 'empty_query',
            },
            this.createSkippedStage(
              'keyword_retrieval',
              'not_implemented_in_p0',
            ),
            this.createSkippedStage('fusion', 'not_implemented_in_p0'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          lowConfidence: true,
          lowConfidenceReason: 'empty_query',
        }),
      };
    }
    const timingsMs: Record<string, number> = {};
    const rewrite = await this.rewriteQuery(normalizedQuery, options);
    const retrievalQuery = rewrite.query;
    if (rewrite.latencyMs !== undefined) {
      timingsMs.queryRewrite = rewrite.latencyMs;
    }

    // 1. 两步查 persona 挂载的 KB + 各自的 retrieval_config
    //    （不用 PostgREST 内联 join，避免 FK 元数据依赖，更稳）
    const { data: mountRows, error: mountErr } = await this.supabase
      .from('persona_knowledge_base')
      .select('knowledge_base_id')
      .eq('persona_id', personaId);

    if (mountErr) {
      this.logger.warn(
        `查询 persona ${personaId} 挂载失败：${mountErr.message}`,
      );
      return {
        query: normalizedQuery,
        results: [],
        debugTrace: this.createDebugTrace({
          chainType: 'persona_retrieval',
          personaId,
          knowledgeBaseIds: [],
          originalQuery: normalizedQuery,
          hits: [],
          timingsMs: { total: Date.now() - startedAt },
          stages: [
            {
              name: 'vector_retrieval',
              skipped: true,
              skipReason: 'mount_query_failed',
              output: { error: mountErr.message },
            },
            this.createSkippedStage(
              'keyword_retrieval',
              'not_implemented_in_p0',
            ),
            this.createSkippedStage('fusion', 'not_implemented_in_p0'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          lowConfidence: true,
          lowConfidenceReason: 'mount_query_failed',
        }),
      };
    }
    if (!mountRows || mountRows.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return {
        query: normalizedQuery,
        results: [],
        debugTrace: this.createDebugTrace({
          chainType: 'persona_retrieval',
          personaId,
          knowledgeBaseIds: [],
          originalQuery: normalizedQuery,
          hits: [],
          timingsMs: { total: Date.now() - startedAt },
          stages: [
            {
              name: 'vector_retrieval',
              skipped: true,
              skipReason: 'no_mounted_knowledge_bases',
            },
            this.createSkippedStage(
              'keyword_retrieval',
              'not_implemented_in_p0',
            ),
            this.createSkippedStage('fusion', 'not_implemented_in_p0'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          lowConfidence: true,
          lowConfidenceReason: 'no_mounted_knowledge_bases',
        }),
      };
    }
    const kbIds = mountRows.map((r) => r.knowledge_base_id as string);

    const { data: kbRows, error: kbErr } = await this.supabase
      .from('knowledge_base')
      .select('id, retrieval_config')
      .in('id', kbIds);

    if (kbErr || !kbRows || kbRows.length === 0) {
      if (kbErr) {
        this.logger.warn(`查询 KB 配置失败：${kbErr.message}`);
      }
      return {
        query: normalizedQuery,
        results: [],
        debugTrace: this.createDebugTrace({
          chainType: 'persona_retrieval',
          personaId,
          knowledgeBaseIds: kbIds,
          originalQuery: normalizedQuery,
          hits: [],
          timingsMs: { total: Date.now() - startedAt },
          stages: [
            {
              name: 'vector_retrieval',
              skipped: true,
              skipReason: 'knowledge_base_config_query_failed',
              output: { error: kbErr?.message },
            },
            this.createSkippedStage(
              'keyword_retrieval',
              'not_implemented_in_p0',
            ),
            this.createSkippedStage('fusion', 'not_implemented_in_p0'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          lowConfidence: true,
          lowConfidenceReason: 'knowledge_base_config_query_failed',
        }),
      };
    }

    // 2. 计算 query embedding（全局复用）
    const queryEmbedding = await this.withTransientRetry(
      'embed query',
      async () => {
        const embedStartedAt = Date.now();
        const embedding = await this.embeddings.embedQuery(retrievalQuery);
        timingsMs.embedQuery = Date.now() - embedStartedAt;
        return embedding;
      },
      3,
    );

    // 3. 并发 stage1，每个 KB 用自己的 threshold / vectorTopK
    const perKbOptions = kbRows.map((kb) => {
      const cfg =
        (kb.retrieval_config as Partial<KnowledgeBaseRetrievalConfig>) ?? {};
      return {
        kbId: kb.id as string,
        threshold: this.toNumber(cfg.threshold, 0.6, 0, 1),
        retrievalMode: this.normalizeRetrievalMode(cfg.retrievalMode),
        vectorTopK: this.toNumber(cfg.vectorTopK ?? cfg.stage1TopK, 20, 1, 50),
        keywordTopK: this.toNumber(cfg.keywordTopK, 20, 1, 50),
        fusion: {
          method: 'rrf' as const,
          rrfK: this.toNumber(cfg.fusion?.rrfK, 60, 1, 200),
          vectorWeight: this.toNumber(cfg.fusion?.vectorWeight, 1, 0, 10),
          keywordWeight: this.toNumber(cfg.fusion?.keywordWeight, 1, 0, 10),
        },
      };
    });

    const vectorStartedAt = Date.now();
    const stage1Results = await Promise.all(
      perKbOptions.map(async (o) => {
        try {
          return await this.retrieveStage1(
            o.kbId,
            queryEmbedding,
            o.threshold,
            o.vectorTopK,
          );
        } catch (e) {
          this.logger.warn(
            `stage1 失败（kb=${o.kbId}）：${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          return [] as KnowledgeChunk[];
        }
      }),
    );
    timingsMs.vectorRetrieval = Date.now() - vectorStartedAt;

    // 4. 合并去重（同一 chunk.id 保留 similarity 最高的那条）
    const dedup = new Map<string, KnowledgeChunk>();
    for (const chunks of stage1Results) {
      for (const c of chunks) {
        const existing = dedup.get(c.id);
        if (!existing || (c.similarity ?? 0) > (existing.similarity ?? 0)) {
          dedup.set(c.id, c);
        }
      }
    }

    const merged = Array.from(dedup.values()).sort(
      (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0),
    );

    // 5. 截断 vectorTopK：取各 KB 里最大的那个（但不少于 20）
    const globalStage1TopK = Math.max(
      20,
      ...perKbOptions.map((o) => o.vectorTopK),
    );
    const stage1Final = merged.slice(0, globalStage1TopK);

    // 6. 全局 rerank；finalTopK 固定为 5（persona 级兜底）
    const GLOBAL_FINAL_TOPK = 5;
    let results = stage1Final.slice(0, GLOBAL_FINAL_TOPK);
    let rerankTrace: RerankTrace | undefined;
    let rankStage: RetrievalRankStage = 'raw';

    const rerankStage: RagStageTrace = {
      name: 'rerank',
      input: {
        enabled: stage1Final.length > 1,
        candidateCount: stage1Final.length,
        finalTopK: GLOBAL_FINAL_TOPK,
      },
    };

    if (stage1Final.length > 1) {
      const rerankStartedAt = Date.now();
      try {
        results = await this.rerankerService.rerank(
          retrievalQuery,
          stage1Final,
          GLOBAL_FINAL_TOPK,
        );
        timingsMs.rerank = Date.now() - rerankStartedAt;
        rankStage = 'rerank';
        rerankTrace = this.createRerankTrace(stage1Final, results, true);
        rerankStage.output = {
          hitCount: results.length,
          hits: results.map((chunk, index) =>
            this.toRetrievalHit(chunk, index + 1, 'rerank'),
          ),
        };
        rerankStage.latencyMs = timingsMs.rerank;
      } catch (e) {
        timingsMs.rerank = Date.now() - rerankStartedAt;
        rerankTrace = this.createRerankTrace(stage1Final, results, true);
        rerankStage.skipped = true;
        rerankStage.skipReason = 'rerank_failed';
        rerankStage.output = {
          error: e instanceof Error ? e.message : String(e),
          fallbackHitCount: results.length,
        };
        rerankStage.latencyMs = timingsMs.rerank;
        this.logger.warn(
          `全局 rerank 失败，回退向量排序：${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    } else {
      rerankTrace = this.createRerankTrace(stage1Final, results, true);
      rerankStage.skipped = true;
      rerankStage.skipReason = 'not_enough_candidates';
      rerankStage.output = {
        hitCount: results.length,
      };
    }

    timingsMs.total = Date.now() - startedAt;
    const confidence = this.assessLowConfidence(results, 0.6);
    const finalHits = results.map((chunk, index) =>
      this.toRetrievalHit(chunk, index + 1, rankStage),
    );

    return {
      query: normalizedQuery,
      results,
      debugTrace: this.createDebugTrace({
        chainType: 'persona_retrieval',
        personaId,
        knowledgeBaseIds: kbIds,
        originalQuery: normalizedQuery,
        rewrittenQuery: retrievalQuery,
        hits: finalHits,
        rerank: rerankTrace,
        timingsMs,
        lowConfidence: confidence.lowConfidence,
        lowConfidenceReason: confidence.reason,
        stages: [
          rewrite.stage,
          {
            name: 'vector_retrieval',
            input: {
              knowledgeBaseIds: kbIds,
              perKnowledgeBaseOptions: perKbOptions,
            },
            output: {
              hitCount: stage1Final.length,
              perKnowledgeBaseHitCounts: stage1Results.map((chunks, index) => ({
                knowledgeBaseId: perKbOptions[index]?.kbId,
                hitCount: chunks.length,
              })),
              hits: stage1Final.map((chunk, index) =>
                this.toRetrievalHit(chunk, index + 1, 'raw'),
              ),
            },
            latencyMs: timingsMs.vectorRetrieval,
          },
          this.createSkippedStage('keyword_retrieval', 'not_implemented_in_p0'),
          this.createSkippedStage('fusion', 'not_implemented_in_p0'),
          rerankStage,
          this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
          this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
        ],
      }),
    };
  }

  private createSkippedStage(
    name: RagStageTrace['name'],
    skipReason: string,
  ): RagStageTrace {
    return {
      name,
      skipped: true,
      skipReason,
    };
  }

  private createDebugTrace(params: {
    chainType: RagDebugTrace['chainType'];
    personaId?: string;
    knowledgeBaseIds: string[];
    originalQuery: string;
    rewrittenQuery?: string;
    retrievalMode?: KnowledgeBaseRetrievalConfig['retrievalMode'];
    hits: RetrievalHit[];
    stages: RagStageTrace[];
    timingsMs: Record<string, number>;
    rerank?: RerankTrace;
    lowConfidence: boolean;
    lowConfidenceReason?: string;
  }): RagDebugTrace {
    return {
      traceId: randomUUID(),
      chainType: params.chainType,
      personaId: params.personaId,
      knowledgeBaseIds: params.knowledgeBaseIds,
      originalQuery: params.originalQuery,
      rewrittenQuery: params.rewrittenQuery ?? params.originalQuery,
      retrievalMode: params.retrievalMode ?? 'vector',
      lowConfidence: params.lowConfidence,
      lowConfidenceReason: params.lowConfidenceReason,
      stages: params.stages,
      hits: params.hits,
      rerank: params.rerank,
      fallback: {
        enabled: false,
        used: false,
        policy: 'never',
        externalSources: [],
      },
      timingsMs: params.timingsMs,
      createdAt: new Date().toISOString(),
    };
  }

  private async rewriteQuery(
    originalQuery: string,
    options: RetrieveKnowledgeOptions,
  ): Promise<{ query: string; stage: RagStageTrace; latencyMs?: number }> {
    if (options.rewrite !== true) {
      return {
        query: originalQuery,
        stage: {
          name: 'query_rewrite',
          skipped: true,
          skipReason: 'disabled',
          input: { originalQuery },
          output: { rewrittenQuery: originalQuery, usedHistory: false },
        },
      };
    }

    const startedAt = Date.now();
    const result: QueryRewriteResult = await this.queryRewriteService.rewrite(
      originalQuery,
      options.history ?? [],
    );
    const latencyMs = Date.now() - startedAt;

    return {
      query: result.rewrittenQuery,
      latencyMs,
      stage: {
        name: 'query_rewrite',
        skipped: Boolean(result.skippedReason),
        skipReason: result.skippedReason,
        input: {
          originalQuery,
          historyTurns: options.history?.length ?? 0,
        },
        output: {
          rewrittenQuery: result.rewrittenQuery,
          usedHistory: result.usedHistory,
        },
        latencyMs,
      },
    };
  }

  private toRetrievalHit(
    chunk: KnowledgeChunk,
    rank: number,
    rankStage: RetrievalRankStage,
  ): RetrievalHit {
    return {
      id: chunk.id,
      chunkId: chunk.id,
      knowledgeBaseId: chunk.knowledge_base_id,
      chunkIndex: chunk.chunk_index,
      sourceName: chunk.source,
      content: chunk.content,
      contentPreview: this.previewContent(chunk.content),
      sources: ['vector'],
      rankStage,
      rank,
      score: chunk.rerank_score ?? chunk.similarity,
      similarity: chunk.similarity,
      rerankScore: chunk.rerank_score,
      metadata: {
        category: chunk.category,
      },
    };
  }

  private previewContent(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 180) return normalized;
    return `${normalized.slice(0, 180)}...`;
  }

  private createRerankTrace(
    before: KnowledgeChunk[],
    after: KnowledgeChunk[],
    enabled: boolean,
  ): RerankTrace {
    return {
      enabled,
      model:
        process.env.RERANKER_MODEL_NAME ??
        process.env.MODEL_NAME ??
        'qwen-plus',
      before: before.map((chunk, index) => ({
        id: chunk.id,
        rank: index + 1,
        score: chunk.similarity,
      })),
      after: after.map((chunk, index) => ({
        id: chunk.id,
        rank: index + 1,
        rerankScore: chunk.rerank_score,
      })),
    };
  }

  private assessLowConfidence(
    chunks: KnowledgeChunk[],
    threshold: number,
  ): { lowConfidence: boolean; reason?: string } {
    if (chunks.length === 0) {
      return { lowConfidence: true, reason: 'no_hits' };
    }
    const topSimilarity = chunks[0]?.similarity ?? 0;
    if (topSimilarity < threshold) {
      return {
        lowConfidence: true,
        reason: 'top_similarity_below_threshold',
      };
    }
    return { lowConfidence: false };
  }

  async ingestDocument(
    kbId: string,
    filename: string,
    content: string,
    opts: { mimeType?: string; fileSize?: number; category?: string } = {},
  ): Promise<KnowledgeDocument> {
    // 1. 创建文档记录
    const doc = await this.docRepo.save(
      this.docRepo.create({
        knowledgeBaseId: kbId,
        filename,
        status: 'processing',
        mimeType: opts.mimeType ?? null,
        fileSize: opts.fileSize ?? null,
      }),
    );

    try {
      // 2. 切分
      const chunks = await this.splitter.createDocuments([content]);
      this.logger.log(
        `[切分完成] filename=${filename} chunks=${chunks.length}`,
      );

      // 3. 向量化
      const texts = chunks.map((c) => c.pageContent);
      this.logger.log(
        `[开始 Embedding] model=${this.embeddings.model} texts=${texts.length} batchSize=${this.embeddingBatchSize}`,
      );
      const embeddings = await this.embeddings.embedDocuments(texts);
      this.logger.log(`[Embedding 完成] dims=${embeddings[0]?.length}`);

      // 4. 写入 Supabase
      const rows = chunks.map((chunk, i) => ({
        document_id: doc.id,
        chunk_index: i,
        content: chunk.pageContent,
        source: filename,
        category: opts.category ?? null,
        embedding: JSON.stringify(embeddings[i]),
      }));
      this.logger.log(`[开始 Insert] rows=${rows.length}`);

      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = await this.withTransientRetry<{
          error: { message: string } | null;
        }>(
          `insert batch ${Math.floor(i / BATCH_SIZE) + 1}`,
          async () => {
            const r = await this.supabase.from('knowledge_chunk').insert(batch);
            return { error: r.error ? { message: r.error.message } : null };
          },
          3,
        );
        if (result.error) throw new Error(result.error.message);
      }
      this.logger.log(
        `[Insert 完成] doc=${doc.id} batches=${Math.ceil(rows.length / BATCH_SIZE)}`,
      );

      // 5. 更新状态
      await this.docRepo.update(doc.id, {
        status: 'completed',
        chunkCount: chunks.length,
      });

      return this.docRepo.findOneBy({
        id: doc.id,
      }) as Promise<KnowledgeDocument>;
    } catch (err) {
      this.logger.error('Ingest failed', err);
      await this.docRepo.update(doc.id, { status: 'failed' });
      throw err;
    }
  }

  listDocumentsByKb(kbId: string): Promise<KnowledgeDocument[]> {
    return this.docRepo.find({
      where: { knowledgeBaseId: kbId },
      order: { createdAt: 'DESC' },
    });
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    return this.chunkRepo
      .createQueryBuilder('c')
      .where('c.document_id = :documentId', { documentId })
      .orderBy('c.chunk_index', 'ASC')
      .getMany();
  }

  async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);
    if (error) throw new Error(error.message);
  }

  private async retrieveStage1(
    kbId: string,
    queryEmbedding: number[],
    threshold: number,
    matchCount: number,
  ): Promise<KnowledgeChunk[]> {
    const { data, error } = await this.withTransientRetry<{
      data: KnowledgeChunk[] | null;
      error: { message: string } | null;
    }>(
      'match_knowledge rpc',
      async () => {
        const result = await this.supabase.rpc('match_knowledge', {
          query_embedding: queryEmbedding,
          p_kb_id: kbId,
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

    if (error) throw new Error(error.message);
    return (data as KnowledgeChunk[]) ?? [];
  }
}
