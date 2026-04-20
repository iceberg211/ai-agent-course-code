import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { KnowledgeDocument } from './domain/knowledge-document.entity';
import { KnowledgeChunk as KnowledgeChunkEntity } from './domain/knowledge-chunk.entity';
import type { KnowledgeBaseRetrievalConfig } from '../knowledge-base/knowledge-base.entity';
import { RerankerService } from './retrieval/reranker.service';
import type {
  ConfidenceMethod,
  ConfidenceTrace,
  MultiHopTrace,
  RagDebugTrace,
  RagStageTrace,
  RerankTrace,
  RetrievalHit,
  RetrievalOrigin,
  RetrievalRankStage,
} from './rag-debug.types';
import { LangSmithTraceService } from './tracing/langsmith-trace.service';
import { HybridRetrievalService } from './retrieval/hybrid-retrieval.service';
import {
  QueryRewriteService,
  type QueryRewriteMessage,
  type QueryRewriteResult,
} from './query-rewrite.service';
import type {
  KnowledgeChunk,
  NormalizedRetrieveOptions,
  RetrieveKnowledgeOptions,
} from './retrieval.types';
export type { KnowledgeChunk } from './retrieval.types';

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
    private readonly hybridRetrievalService: HybridRetrievalService,
    private readonly rerankerService: RerankerService,
    private readonly queryRewriteService: QueryRewriteService,
    private readonly langSmithTraceService: LangSmithTraceService,
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
    const candidateLimit = this.toNumber(
      options.candidateLimit,
      vectorTopK + keywordTopK,
      finalTopK,
      100,
    );

    return {
      retrievalMode: this.normalizeRetrievalMode(options.retrievalMode),
      threshold,
      rerank,
      stage1TopK: vectorTopK,
      vectorTopK,
      keywordTopK,
      candidateLimit,
      finalTopK,
      fusion: {
        method: 'rrf',
        rrfK: this.toNumber(options.fusion?.rrfK, 60, 1, 200),
        vectorWeight: this.toNumber(options.fusion?.vectorWeight, 1, 0, 10),
        keywordWeight: this.toNumber(options.fusion?.keywordWeight, 1, 0, 10),
      },
      confidence: {
        keywordBm25SaturationScore: this.toNumber(
          options.confidence?.keywordBm25SaturationScore,
          12,
          1,
          100,
        ),
        minSupportingHits: this.toNumber(
          options.confidence?.minSupportingHits,
          1,
          1,
          10,
        ),
      },
      rewrite: options.rewrite === true,
    };
  }

  private resolvePersonaStage2Options(
    perKbOptions: Array<{ kbId: string } & NormalizedRetrieveOptions>,
    options: RetrieveKnowledgeOptions,
  ): Pick<
    NormalizedRetrieveOptions,
    'retrievalMode' | 'threshold' | 'rerank' | 'candidateLimit' | 'finalTopK' | 'confidence'
  > {
    const retrievalMode = this.aggregateRetrievalMode(
      perKbOptions.map((item) => item.retrievalMode),
    );
    const threshold = Math.min(...perKbOptions.map((item) => item.threshold));
    const finalTopK =
      options.finalTopK !== undefined
        ? this.toNumber(options.finalTopK, 5, 1, 20)
        : Math.max(...perKbOptions.map((item) => item.finalTopK));
    const candidateLimit =
      options.candidateLimit !== undefined
        ? this.toNumber(options.candidateLimit, finalTopK, finalTopK, 100)
        : Math.max(finalTopK, ...perKbOptions.map((item) => item.candidateLimit));
    const rerank =
      options.rerank !== undefined
        ? options.rerank !== false
        : perKbOptions.some((item) => item.rerank);

    return {
      retrievalMode,
      threshold,
      rerank,
      candidateLimit,
      finalTopK,
      confidence: {
        keywordBm25SaturationScore: Math.max(
          ...perKbOptions.map((item) => item.confidence.keywordBm25SaturationScore),
        ),
        minSupportingHits: Math.max(
          ...perKbOptions.map((item) => item.confidence.minSupportingHits),
        ),
      },
    };
  }

  private aggregateRetrievalMode(
    modes: KnowledgeBaseRetrievalConfig['retrievalMode'][],
  ): KnowledgeBaseRetrievalConfig['retrievalMode'] {
    const uniqueModes = Array.from(new Set(modes));
    if (uniqueModes.length === 0) return 'vector';
    if (uniqueModes.length === 1) return uniqueModes[0];
    return 'hybrid';
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
    return this.langSmithTraceService.trace(
      {
        name: 'knowledge.retrieve_with_stages',
        runType: 'retriever',
        tags: ['rag', 'knowledge', 'kb-hit-test'],
        metadata: {
          chainType: 'kb_hit_test',
          feature: 'knowledge_retrieval',
          retrievalMode: this.normalizeRetrievalMode(options.retrievalMode),
          rewrite: options.rewrite === true,
          rerank: options.rerank !== false,
        },
        inputs: this.buildTraceInputs({
          knowledgeBaseId: kbId,
          query,
          options,
        }),
        processOutputs: (result) => ({
          traceId: result.debugTrace.traceId,
          langsmithRunId: result.debugTrace.langsmithRunId,
          retrievalMode: result.debugTrace.retrievalMode,
          stage1Count: result.stage1.length,
          stage2Count: result.stage2.length,
          lowConfidence: result.debugTrace.lowConfidence,
          lowConfidenceReason: result.debugTrace.lowConfidenceReason,
        }),
      },
      async () => this.retrieveWithStagesInternal(kbId, query, options),
    );
  }

  private async retrieveWithStagesInternal(
    kbId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<RetrieveKnowledgeDebugResult> {
    const startedAt = Date.now();
    const normalizedQuery = query.trim();
    const normalizedOptions = this.normalizeRetrieveOptions(options);

    if (!normalizedQuery) {
      const emptyConfidence: ConfidenceTrace = {
        finalConfidence: 0,
        threshold: normalizedOptions.threshold,
        method: 'none',
        signals: {},
      };
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
          this.createSkippedStage('keyword_retrieval', 'empty_query'),
          this.createSkippedStage('fusion', 'empty_query'),
          this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
          this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
        ],
        confidence: emptyConfidence,
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

    const queryEmbedding = await this.maybeEmbedQuery(
      retrievalQuery,
      normalizedOptions.retrievalMode,
      timingsMs,
    );
    const retrievalStartedAt = Date.now();
    const retrievalResult =
      await this.hybridRetrievalService.retrieveForKnowledgeBase({
        kbId,
        query: retrievalQuery,
        options: normalizedOptions,
        queryEmbedding,
      });
    if (normalizedOptions.retrievalMode !== 'keyword') {
      timingsMs.vectorRetrieval = Date.now() - retrievalStartedAt;
    }
    if (normalizedOptions.retrievalMode !== 'vector') {
      timingsMs.keywordRetrieval = Date.now() - retrievalStartedAt;
    }
    if (normalizedOptions.retrievalMode === 'hybrid') {
      timingsMs.fusion = Date.now() - retrievalStartedAt;
    }

    const stage1 = retrievalResult.stage1Hits;

    let stage2 = stage1.slice(0, normalizedOptions.finalTopK);
    let rerankTrace: RerankTrace | undefined;
    let rankStage: RetrievalRankStage =
      normalizedOptions.retrievalMode === 'hybrid' ? 'fusion' : 'raw';
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
    const confidenceResult = this.assessLowConfidence(
      stage2,
      normalizedOptions,
    );
    timingsMs.total = Date.now() - startedAt;

    const debugTrace = this.createDebugTrace({
      chainType: 'kb_hit_test',
      knowledgeBaseIds: [kbId],
      originalQuery: normalizedQuery,
      rewrittenQuery: retrievalQuery,
      retrievalMode: normalizedOptions.retrievalMode,
      hits: finalHits,
      rerank: rerankTrace,
      timingsMs,
      confidence: confidenceResult.confidence,
      lowConfidence: confidenceResult.lowConfidence,
      lowConfidenceReason: confidenceResult.reason,
      stages: [
        rewrite.stage,
        this.createVectorStageTrace(
          kbId,
          normalizedOptions,
          retrievalResult.vectorHits,
          timingsMs.vectorRetrieval,
        ),
        this.createKeywordStageTrace(
          kbId,
          normalizedOptions,
          retrievalResult.keywordHits,
          timingsMs.keywordRetrieval,
        ),
        this.createFusionStageTrace(
          normalizedOptions,
          retrievalResult.stage1Hits,
          timingsMs.fusion,
        ),
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
    return this.langSmithTraceService.trace(
      {
        name: 'knowledge.retrieve_for_persona',
        runType: 'retriever',
        tags: ['rag', 'knowledge', 'persona-retrieval'],
        metadata: {
          chainType: 'persona_retrieval',
          feature: 'knowledge_retrieval',
          retrievalMode: this.normalizeRetrievalMode(options.retrievalMode),
          rewrite: options.rewrite === true,
        },
        inputs: this.buildTraceInputs({
          personaId,
          query,
          options,
        }),
        processOutputs: (result) => ({
          traceId: result.debugTrace.traceId,
          langsmithRunId: result.debugTrace.langsmithRunId,
          retrievalMode: result.debugTrace.retrievalMode,
          resultCount: result.results.length,
          lowConfidence: result.debugTrace.lowConfidence,
          lowConfidenceReason: result.debugTrace.lowConfidenceReason,
        }),
      },
      async () =>
        this.retrieveForPersonaWithTraceInternal(personaId, query, options),
    );
  }

  private async retrieveForPersonaWithTraceInternal(
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
            this.createSkippedStage('keyword_retrieval', 'empty_query'),
            this.createSkippedStage('fusion', 'empty_query'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          confidence: {
            finalConfidence: 0,
            threshold: 0,
            method: 'none',
            signals: {},
          },
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
            this.createSkippedStage('keyword_retrieval', 'mount_query_failed'),
            this.createSkippedStage('fusion', 'mount_query_failed'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          confidence: {
            finalConfidence: 0,
            threshold: 0,
            method: 'none',
            signals: {},
          },
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
              'no_mounted_knowledge_bases',
            ),
            this.createSkippedStage('fusion', 'no_mounted_knowledge_bases'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          confidence: {
            finalConfidence: 0,
            threshold: 0,
            method: 'none',
            signals: {},
          },
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
              'knowledge_base_config_query_failed',
            ),
            this.createSkippedStage('fusion', 'knowledge_base_config_query_failed'),
            this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
            this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
          ],
          confidence: {
            finalConfidence: 0,
            threshold: 0,
            method: 'none',
            signals: {},
          },
          lowConfidence: true,
          lowConfidenceReason: 'knowledge_base_config_query_failed',
        }),
      };
    }

    // 2. 计算 query embedding（全局复用）
    const perKbOptions = kbRows.map((kb) => {
      const cfg =
        (kb.retrieval_config as Partial<KnowledgeBaseRetrievalConfig>) ?? {};
      const overrideOptions: RetrieveKnowledgeOptions = {
        retrievalMode: options.retrievalMode,
        threshold: options.threshold,
        rerank: options.rerank,
        stage1TopK: options.stage1TopK,
        vectorTopK: options.vectorTopK,
        keywordTopK: options.keywordTopK,
        candidateLimit: options.candidateLimit,
        finalTopK: options.finalTopK,
        fusion: options.fusion,
        confidence: options.confidence,
      };
      return {
        kbId: kb.id as string,
        ...this.normalizeRetrieveOptions({
          threshold: cfg.threshold,
          retrievalMode: cfg.retrievalMode,
          stage1TopK: cfg.stage1TopK,
          vectorTopK: cfg.vectorTopK,
          keywordTopK: cfg.keywordTopK,
          candidateLimit: cfg.candidateLimit,
          finalTopK: cfg.finalTopK,
          rerank: cfg.rerank,
          fusion: cfg.fusion,
          confidence: cfg.confidence,
          ...overrideOptions,
        }),
      };
    });
    const needEmbedding = perKbOptions.some((o) =>
      this.hybridRetrievalService.needsVectorEmbedding(o.retrievalMode),
    );
    const queryEmbedding = needEmbedding
      ? await this.maybeEmbedQuery(retrievalQuery, 'vector', timingsMs)
      : undefined;

    const retrievalStartedAt = Date.now();
    const stage1Results = await Promise.all(
      perKbOptions.map(async (o) => {
        try {
          return await this.hybridRetrievalService.retrieveForKnowledgeBase({
            kbId: o.kbId,
            query: retrievalQuery,
            options: o,
            queryEmbedding,
          });
        } catch (e) {
          this.logger.warn(
            `stage1 失败（kb=${o.kbId}）：${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          return {
            vectorHits: [],
            keywordHits: [],
            stage1Hits: [],
          };
        }
      }),
    );
    timingsMs.vectorRetrieval = Date.now() - retrievalStartedAt;
    timingsMs.keywordRetrieval = Date.now() - retrievalStartedAt;
    timingsMs.fusion = Date.now() - retrievalStartedAt;

    // 4. 合并去重（同一 chunk.id 保留融合分数更高、来源更完整的那条）
    const dedup = new Map<string, KnowledgeChunk>();
    for (const result of stage1Results) {
      for (const c of result.stage1Hits) {
        const existing = dedup.get(c.id);
        if (
          !existing ||
          (c.fusion_score ?? c.similarity ?? c.bm25_score ?? 0) >
            (existing.fusion_score ??
              existing.similarity ??
              existing.bm25_score ??
              0)
        ) {
          dedup.set(c.id, c);
        }
      }
    }

    const merged = Array.from(dedup.values()).sort(
      (a, b) =>
        (b.fusion_score ?? b.similarity ?? b.bm25_score ?? 0) -
        (a.fusion_score ?? a.similarity ?? a.bm25_score ?? 0),
    );

    const personaStage2Options = this.resolvePersonaStage2Options(
      perKbOptions,
      options,
    );
    const stage1Final = merged.slice(0, personaStage2Options.candidateLimit);

    // 6. 全局 stage2：按 persona 聚合后的配置决定是否 rerank、保留多少结果
    let results = stage1Final.slice(0, personaStage2Options.finalTopK);
    let rerankTrace: RerankTrace | undefined;
    let rankStage: RetrievalRankStage =
      personaStage2Options.retrievalMode === 'hybrid' ? 'fusion' : 'raw';

    const rerankStage: RagStageTrace = {
      name: 'rerank',
      input: {
        enabled: personaStage2Options.rerank,
        candidateCount: stage1Final.length,
        finalTopK: personaStage2Options.finalTopK,
      },
    };

    if (personaStage2Options.rerank && stage1Final.length > 1) {
      const rerankStartedAt = Date.now();
      try {
        results = await this.rerankerService.rerank(
          retrievalQuery,
          stage1Final,
          personaStage2Options.finalTopK,
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
      rerankTrace = this.createRerankTrace(
        stage1Final,
        results,
        personaStage2Options.rerank,
      );
      rerankStage.skipped = true;
      rerankStage.skipReason = personaStage2Options.rerank
        ? 'not_enough_candidates'
        : 'disabled';
      rerankStage.output = {
        hitCount: results.length,
      };
    }

    timingsMs.total = Date.now() - startedAt;
    const confidenceResult = this.assessLowConfidence(
      results,
      personaStage2Options,
    );
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
        retrievalMode: personaStage2Options.retrievalMode,
        hits: finalHits,
        rerank: rerankTrace,
        timingsMs,
        confidence: confidenceResult.confidence,
        lowConfidence: confidenceResult.lowConfidence,
        lowConfidenceReason: confidenceResult.reason,
        stages: [
          rewrite.stage,
          {
            name: 'vector_retrieval',
            skipped: !perKbOptions.some((item) => item.retrievalMode !== 'keyword'),
            skipReason: perKbOptions.some((item) => item.retrievalMode !== 'keyword')
              ? undefined
              : 'disabled',
            input: {
              knowledgeBaseIds: kbIds,
              perKnowledgeBaseOptions: perKbOptions.map((item) => ({
                knowledgeBaseId: item.kbId,
                retrievalMode: item.retrievalMode,
                threshold: item.threshold,
                vectorTopK: item.vectorTopK,
              })),
            },
            output: {
              hitCount: stage1Results.reduce(
                (sum, item) => sum + item.vectorHits.length,
                0,
              ),
              perKnowledgeBaseHitCounts: stage1Results.map((item, index) => ({
                knowledgeBaseId: perKbOptions[index]?.kbId,
                hitCount: item.vectorHits.length,
              })),
            },
            latencyMs: timingsMs.vectorRetrieval,
          },
          {
            name: 'keyword_retrieval',
            skipped: !perKbOptions.some((item) => item.retrievalMode !== 'vector'),
            skipReason: perKbOptions.some((item) => item.retrievalMode !== 'vector')
              ? undefined
              : 'disabled',
            input: {
              knowledgeBaseIds: kbIds,
              perKnowledgeBaseOptions: perKbOptions.map((item) => ({
                knowledgeBaseId: item.kbId,
                retrievalMode: item.retrievalMode,
                keywordTopK: item.keywordTopK,
              })),
            },
            output: {
              hitCount: stage1Results.reduce(
                (sum, item) => sum + item.keywordHits.length,
                0,
              ),
              perKnowledgeBaseHitCounts: stage1Results.map((item, index) => ({
                knowledgeBaseId: perKbOptions[index]?.kbId,
                hitCount: item.keywordHits.length,
              })),
            },
            latencyMs: timingsMs.keywordRetrieval,
          },
          {
            name: 'fusion',
            skipped: !perKbOptions.some((item) => item.retrievalMode === 'hybrid'),
            skipReason: perKbOptions.some((item) => item.retrievalMode === 'hybrid')
              ? undefined
              : 'disabled',
            input: {
              candidateLimit: personaStage2Options.candidateLimit,
            },
            output: {
              hitCount: stage1Final.length,
              hits: stage1Final.map((chunk, index) =>
                this.toRetrievalHit(chunk, index + 1, 'fusion'),
              ),
            },
            latencyMs: timingsMs.fusion,
          },
          rerankStage,
          this.createSkippedStage('multi_hop', 'not_implemented_in_p0'),
          this.createSkippedStage('web_fallback', 'not_implemented_in_p0'),
        ],
      }),
    };
  }

  private buildTraceInputs(params: {
    query: string;
    options: RetrieveKnowledgeOptions;
    knowledgeBaseId?: string;
    personaId?: string;
  }): Record<string, unknown> {
    return {
      knowledgeBaseId: params.knowledgeBaseId,
      personaId: params.personaId,
      query: params.query,
      retrievalMode: this.normalizeRetrievalMode(params.options.retrievalMode),
      threshold: params.options.threshold,
      stage1TopK: params.options.stage1TopK,
      vectorTopK: params.options.vectorTopK,
      keywordTopK: params.options.keywordTopK,
      candidateLimit: params.options.candidateLimit,
      finalTopK: params.options.finalTopK,
      rerank: params.options.rerank !== false,
      rewrite: params.options.rewrite === true,
      historyTurns: params.options.history?.length ?? 0,
      fusion: params.options.fusion,
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
    confidence: ConfidenceTrace;
    lowConfidence: boolean;
    lowConfidenceReason?: string;
    multiHop?: MultiHopTrace;
  }): RagDebugTrace {
    return {
      traceId: randomUUID(),
      langsmithRunId: this.langSmithTraceService.currentRunId(),
      chainType: params.chainType,
      personaId: params.personaId,
      knowledgeBaseIds: params.knowledgeBaseIds,
      originalQuery: params.originalQuery,
      rewrittenQuery: params.rewrittenQuery ?? params.originalQuery,
      retrievalMode: params.retrievalMode ?? 'vector',
      lowConfidence: params.lowConfidence,
      lowConfidenceReason: params.lowConfidenceReason,
      confidence: params.confidence,
      stages: params.stages,
      hits: params.hits,
      rerank: params.rerank,
      multiHop: params.multiHop ?? {
        enabled: false,
        subQuestions: [],
        hops: [],
      },
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
      documentId: chunk.document_id,
      knowledgeBaseId: chunk.knowledge_base_id,
      chunkIndex: chunk.chunk_index,
      sourceName: chunk.source,
      content: chunk.content,
      contentPreview: this.previewContent(chunk.content),
      sources: chunk.sources ?? ['vector'],
      rankStage,
      rank,
      originalRanks: chunk.original_ranks,
      score:
        chunk.rerank_score ?? chunk.fusion_score ?? chunk.bm25_score ?? chunk.similarity,
      similarity: chunk.similarity,
      bm25Score: chunk.bm25_score,
      fusionScore: chunk.fusion_score,
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
        score: chunk.fusion_score ?? chunk.bm25_score ?? chunk.similarity,
      })),
      after: after.map((chunk, index) => ({
        id: chunk.id,
        rank: index + 1,
        rerankScore: chunk.rerank_score,
      })),
    };
  }

  /**
   * 评估当前检索结果的置信度。
   *
   * 返回 ConfidenceTrace，其中 finalConfidence 是低置信度判断的唯一数值入口（范围 0-1）。
   * vector / keyword / hybrid 都在这里统一折算，前端和 fallback 只读取 finalConfidence。
   */
  private assessLowConfidence(
    chunks: KnowledgeChunk[],
    options: Pick<
      NormalizedRetrieveOptions,
      'retrievalMode' | 'threshold' | 'confidence'
    >,
    minConfidence = 0.45,
  ): { confidence: ConfidenceTrace; lowConfidence: boolean; reason?: string } {
    if (chunks.length === 0) {
      const confidence: ConfidenceTrace = {
        finalConfidence: 0,
        threshold: options.threshold,
        method: 'none' as ConfidenceMethod,
        signals: {},
      };
      return {
        confidence,
        lowConfidence: true,
        reason: 'no_hits',
      };
    }

    const topSimilarity = chunks[0]?.similarity ?? 0;
    const topBm25Score = chunks[0]?.bm25_score ?? 0;
    const normalizedBm25 = Math.min(
      1,
      topBm25Score / options.confidence.keywordBm25SaturationScore,
    );
    const topFusionScore = chunks[0]?.fusion_score;
    const topRerankScoreRaw = chunks[0]?.rerank_score;
    const topRerankScore =
      topRerankScoreRaw !== undefined
        ? Math.min(1, Math.max(0, topRerankScoreRaw / 10))
        : undefined;

    let finalConfidence = topSimilarity;
    let method: ConfidenceMethod = 'vector_similarity';
    if (options.retrievalMode === 'keyword') {
      finalConfidence = normalizedBm25;
      method = 'keyword_bm25_normalized';
    } else if (options.retrievalMode === 'hybrid') {
      finalConfidence =
        topRerankScore ?? Math.max(topSimilarity, normalizedBm25);
      method =
        topRerankScore !== undefined ? 'hybrid_rerank' : 'vector_similarity';
    }

    const confidence: ConfidenceTrace = {
      finalConfidence,
      threshold: options.threshold,
      method,
      signals: {
        topSimilarity,
        topBm25Score,
        normalizedBm25,
        topFusionScore,
        topRerankScore,
        supportingHits: chunks.length,
      },
    };

    const lowConfidence =
      finalConfidence < minConfidence ||
      chunks.length < options.confidence.minSupportingHits;
    return {
      confidence,
      lowConfidence,
      reason: lowConfidence
        ? chunks.length < options.confidence.minSupportingHits
          ? 'supporting_hits_below_min'
          : 'final_confidence_below_min_confidence'
        : undefined,
    };
  }

  private async maybeEmbedQuery(
    retrievalQuery: string,
    retrievalMode: KnowledgeBaseRetrievalConfig['retrievalMode'],
    timingsMs: Record<string, number>,
  ): Promise<number[] | undefined> {
    if (!this.hybridRetrievalService.needsVectorEmbedding(retrievalMode)) {
      return undefined;
    }
    return this.withTransientRetry(
      'embed query',
      async () => {
        const embedStartedAt = Date.now();
        const embedding = await this.embeddings.embedQuery(retrievalQuery);
        timingsMs.embedQuery = Date.now() - embedStartedAt;
        return embedding;
      },
      3,
    );
  }

  private createVectorStageTrace(
    kbId: string,
    options: NormalizedRetrieveOptions,
    vectorHits: KnowledgeChunk[],
    latencyMs?: number,
  ): RagStageTrace {
    if (options.retrievalMode === 'keyword') {
      return this.createSkippedStage('vector_retrieval', 'disabled');
    }
    return {
      name: 'vector_retrieval',
      input: {
        knowledgeBaseId: kbId,
        threshold: options.threshold,
        topK: options.vectorTopK,
      },
      output: {
        hitCount: vectorHits.length,
        hits: vectorHits.map((chunk, index) =>
          this.toRetrievalHit(chunk, index + 1, 'raw'),
        ),
      },
      latencyMs,
    };
  }

  private createKeywordStageTrace(
    kbId: string,
    options: NormalizedRetrieveOptions,
    keywordHits: KnowledgeChunk[],
    latencyMs?: number,
  ): RagStageTrace {
    if (options.retrievalMode === 'vector') {
      return this.createSkippedStage('keyword_retrieval', 'disabled');
    }
    return {
      name: 'keyword_retrieval',
      input: {
        knowledgeBaseId: kbId,
        topK: options.keywordTopK,
      },
      output: {
        hitCount: keywordHits.length,
        hits: keywordHits.map((chunk, index) =>
          this.toRetrievalHit(chunk, index + 1, 'raw'),
        ),
      },
      latencyMs,
    };
  }

  private createFusionStageTrace(
    options: NormalizedRetrieveOptions,
    stage1Hits: KnowledgeChunk[],
    latencyMs?: number,
  ): RagStageTrace {
    if (options.retrievalMode !== 'hybrid') {
      return this.createSkippedStage('fusion', 'disabled');
    }
    return {
      name: 'fusion',
      input: {
        candidateLimit: options.candidateLimit,
        fusion: options.fusion,
      },
      output: {
        hitCount: stage1Hits.length,
        hits: stage1Hits.map((chunk, index) =>
          this.toRetrievalHit(chunk, index + 1, 'fusion'),
        ),
      },
      latencyMs,
    };
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

}
