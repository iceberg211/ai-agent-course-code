import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk as KnowledgeChunkEntity } from './knowledge-chunk.entity';
import type { KnowledgeBaseRetrievalConfig } from '../knowledge-base/knowledge-base.entity';
import { RerankerService } from './reranker.service';

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  similarity: number;
  rerank_score?: number;
}

export interface RetrieveKnowledgeOptions {
  threshold?: number;
  rerank?: boolean;
  stage1TopK?: number;
  finalTopK?: number;
}

export interface RetrieveKnowledgeDebugResult {
  query: string;
  options: Required<RetrieveKnowledgeOptions>;
  stage1: KnowledgeChunk[];
  stage2: KnowledgeChunk[];
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly embeddings = new OpenAIEmbeddings({
    model: process.env.EMBEDDINGS_MODEL_NAME ?? 'text-embedding-v3',
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
  ): Required<RetrieveKnowledgeOptions> {
    const finalTopK = this.toNumber(options.finalTopK, 5, 1, 20);
    const rerank = options.rerank !== false;
    const stage1Default = rerank ? Math.max(20, finalTopK) : finalTopK;
    const stage1TopK = this.toNumber(
      options.stage1TopK,
      stage1Default,
      finalTopK,
      50,
    );
    const threshold = this.toNumber(options.threshold, 0.6, 0, 1);

    return {
      threshold,
      rerank,
      stage1TopK,
      finalTopK,
    };
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
    const normalizedQuery = query.trim();
    const normalizedOptions = this.normalizeRetrieveOptions(options);

    if (!normalizedQuery) {
      return {
        query: normalizedQuery,
        options: normalizedOptions,
        stage1: [],
        stage2: [],
      };
    }

    const queryEmbedding = await this.withTransientRetry(
      'embed query',
      () => this.embeddings.embedQuery(normalizedQuery),
      3,
    );

    const stage1 = await this.retrieveStage1(
      kbId,
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
  ): Promise<KnowledgeChunk[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

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
      return [];
    }
    if (!mountRows || mountRows.length === 0) {
      this.logger.log(`persona ${personaId} 未挂载任何知识库`);
      return [];
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
      return [];
    }

    // 2. 计算 query embedding（全局复用）
    const queryEmbedding = await this.withTransientRetry(
      'embed query',
      () => this.embeddings.embedQuery(normalizedQuery),
      3,
    );

    // 3. 并发 stage1，每个 KB 用自己的 threshold / stage1TopK
    const perKbOptions = kbRows.map((kb) => {
      const cfg =
        (kb.retrieval_config as Partial<KnowledgeBaseRetrievalConfig>) ?? {};
      return {
        kbId: kb.id as string,
        threshold: this.toNumber(cfg.threshold, 0.6, 0, 1),
        stage1TopK: this.toNumber(cfg.stage1TopK, 20, 1, 50),
      };
    });

    const stage1Results = await Promise.all(
      perKbOptions.map(async (o) => {
        try {
          return await this.retrieveStage1(
            o.kbId,
            queryEmbedding,
            o.threshold,
            o.stage1TopK,
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

    // 5. 截断 stage1TopK：取各 KB 里最大的那个（但不少于 20）
    const globalStage1TopK = Math.max(
      20,
      ...perKbOptions.map((o) => o.stage1TopK),
    );
    const stage1Final = merged.slice(0, globalStage1TopK);

    // 6. 全局 rerank；finalTopK 固定为 5（persona 级兜底）
    const GLOBAL_FINAL_TOPK = 5;
    if (stage1Final.length <= 1) return stage1Final;

    try {
      return await this.rerankerService.rerank(
        normalizedQuery,
        stage1Final,
        GLOBAL_FINAL_TOPK,
      );
    } catch (e) {
      this.logger.warn(
        `全局 rerank 失败，回退向量排序：${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return stage1Final.slice(0, GLOBAL_FINAL_TOPK);
    }
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
        `[开始 Embedding] model=${this.embeddings.model} texts=${texts.length}`,
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
