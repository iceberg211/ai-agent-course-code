import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { KnowledgeDocument } from './knowledge-document.entity';
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
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
    private readonly rerankerService: RerankerService,
  ) {}

  async ingestDocument(
    personaId: string,
    filename: string,
    content: string,
    category?: string,
  ): Promise<KnowledgeDocument> {
    // 解析 persona 的默认知识库 id
    // Phase 1 只有 1 对 1 映射（003 migration 保证每个 persona 有 owner KB）
    // Phase 2 引入 KnowledgeBaseService 后改为通过 service 层查询
    const { data: kbRow, error: kbErr } = await this.supabase
      .from('knowledge_base')
      .select('id')
      .eq('owner_persona_id', personaId)
      .limit(1)
      .single();
    if (kbErr || !kbRow?.id) {
      throw new Error(
        `未找到 persona ${personaId} 的默认知识库，请确认 003 migration 已执行`,
      );
    }
    const knowledgeBaseId = kbRow.id as string;

    // 1. 创建文档记录
    const doc = await this.docRepo.save(
      this.docRepo.create({
        knowledgeBaseId,
        filename,
        status: 'processing',
      }),
    );

    try {
      // 2. 切分
      const chunks = await this.splitter.createDocuments([content]);
      this.logger.log(
        `[切分完成] filename=${filename} chunks=${chunks.length}`,
      );

      // 3. 向量化（批量）
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
        category: category ?? null,
        embedding: JSON.stringify(embeddings[i]),
      }));
      this.logger.log(`[开始 Insert] 准备插入 Supabase rows=${rows.length}`);

      // 分批写入，避免单次 insert 请求体过大（向量数据量很大）
      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = await this.withTransientRetry<{
          error: { message: string } | null;
        }>(
          `insert batch ${Math.floor(i / BATCH_SIZE) + 1}`,
          async () => {
            const r = await this.supabase
              .from('knowledge_chunk')
              .insert(batch);
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

  async retrieve(
    personaId: string,
    query: string,
    options: RetrieveKnowledgeOptions = {},
  ): Promise<KnowledgeChunk[]> {
    try {
      const result = await this.retrieveWithStages(personaId, query, options);
      return result.stage2;
    } catch (error) {
      this.logger.warn(
        `知识检索失败，降级为空知识：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  async retrieveWithStages(
    personaId: string,
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
      personaId,
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

  listDocuments(personaId: string): Promise<KnowledgeDocument[]> {
    return this.docRepo
      .createQueryBuilder('doc')
      .innerJoin('persona_knowledge_base', 'pkb', 'pkb.knowledge_base_id = doc.knowledge_base_id')
      .where('pkb.persona_id = :personaId', { personaId })
      .orderBy('doc.created_at', 'DESC')
      .getMany();
  }

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

  private async retrieveStage1(
    personaId: string,
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
        // Phase 1 过渡期：Agent 仍按 personaId 检索，走 shim RPC 在 SQL 内部
        // 翻译为 kb_ids。Phase 2 切换到 retrieveForPersona + match_knowledge
        // (单 KB 版) 后，删除此调用并删除 match_knowledge_legacy shim。
        const result = await this.supabase.rpc('match_knowledge_legacy', {
          query_embedding: queryEmbedding,
          p_persona_id: personaId,
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
