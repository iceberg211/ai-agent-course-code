import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '@/common/constants';
import type { RetrieveKnowledgeDebugResult } from '@/knowledge-content/types/knowledge-content.types';

export interface RagSemanticCachePayload {
  result?: Omit<RetrieveKnowledgeDebugResult, 'cache'>;
  stage1ChunkIds?: string[];
  stage2ChunkIds?: string[];
  compressedContext?: string;
  trace?: unknown;
}

export interface RagSemanticCacheLookupResult {
  cacheKey: string;
  payload: RagSemanticCachePayload;
  similarity: number | null;
  expiresAt: string;
}

export interface RagSemanticCacheScope {
  personaId: string;
  mountedKnowledgeBaseFingerprints: string[];
  retrievalConfig: Record<string, unknown>;
  models: Record<string, unknown>;
  strategyFlags: Record<string, unknown>;
  indexVersions: Record<string, unknown>;
}

export interface RagSemanticCacheSimilarLookupInput extends RagSemanticCacheScope {
  queryEmbedding: number[];
  minSimilarity?: number;
  matchCount?: number;
}

export interface RagSemanticCacheUpsertInput extends RagSemanticCacheScope {
  cacheKey: string;
  normalizedQueryHash: string;
  query: string;
  queryEmbedding: number[];
  mountedKnowledgeBaseIds: string[];
  backend: Record<string, unknown>;
  payload: RagSemanticCachePayload;
  ttlSeconds?: number;
}

@Injectable()
export class RagSemanticCacheStoreService {
  private readonly logger = new Logger(RagSemanticCacheStoreService.name);

  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  isEnabled(): boolean {
    return normalizeBoolean(process.env.RAG_SEMANTIC_CACHE_ENABLED);
  }

  async getByKey(cacheKey: string): Promise<RagSemanticCacheLookupResult | null> {
    if (!this.isEnabled()) return null;

    const { data, error } = await this.supabase
      .from('rag_semantic_cache')
      .select('cache_key,payload,expires_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      this.logger.warn(`读取 RAG 语义缓存失败：${error.message}`);
      return null;
    }

    return toLookupResult(data, null);
  }

  async findSimilar(
    input: RagSemanticCacheSimilarLookupInput,
  ): Promise<RagSemanticCacheLookupResult | null> {
    if (!this.isEnabled()) return null;
    if (input.queryEmbedding.length === 0) return null;

    const { data, error } = await this.supabase.rpc('match_rag_semantic_cache', {
      p_persona_id: input.personaId,
      p_query_embedding: toVectorLiteral(input.queryEmbedding),
      p_mounted_knowledge_base_fingerprints:
        input.mountedKnowledgeBaseFingerprints,
      p_retrieval_config: input.retrievalConfig,
      p_models: input.models,
      p_strategy_flags: input.strategyFlags,
      p_index_versions: input.indexVersions,
      p_min_similarity:
        input.minSimilarity ?? readNumberEnv('RAG_SEMANTIC_CACHE_MIN_SIMILARITY', 0.92),
      p_match_count: input.matchCount ?? 1,
    });

    if (error) {
      this.logger.warn(`查询 RAG 相似缓存失败：${error.message}`);
      return null;
    }

    const first = Array.isArray(data) ? data[0] : null;
    return toLookupResult(first, first?.similarity ?? null);
  }

  async upsert(
    input: RagSemanticCacheUpsertInput,
  ): Promise<{ written: boolean; reason?: 'disabled' }> {
    if (!this.isEnabled()) {
      return { written: false, reason: 'disabled' };
    }

    const expiresAt = new Date(
      Date.now() + (input.ttlSeconds ?? readNumberEnv('RAG_SEMANTIC_CACHE_TTL_SECONDS', 1800)) * 1000,
    ).toISOString();

    const { error } = await this.supabase.from('rag_semantic_cache').upsert(
      {
        cache_key: input.cacheKey,
        persona_id: input.personaId,
        normalized_query_hash: input.normalizedQueryHash,
        query: input.query,
        query_embedding: toVectorLiteral(input.queryEmbedding),
        mounted_knowledge_base_ids: input.mountedKnowledgeBaseIds,
        mounted_knowledge_base_fingerprints:
          input.mountedKnowledgeBaseFingerprints,
        retrieval_config: input.retrievalConfig,
        backend: input.backend,
        models: input.models,
        strategy_flags: input.strategyFlags,
        index_versions: input.indexVersions,
        payload: input.payload,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' },
    );

    if (error) {
      this.logger.warn(`写入 RAG 语义缓存失败：${error.message}`);
      return { written: false };
    }

    return { written: true };
  }
}

function toLookupResult(
  row: unknown,
  similarity: number | null,
): RagSemanticCacheLookupResult | null {
  if (!isRecord(row)) return null;
  const cacheKey = readString(row.cache_key);
  const expiresAt = readString(row.expires_at);
  if (!cacheKey || !expiresAt) return null;
  return {
    cacheKey,
    payload: isRecord(row.payload) ? row.payload : {},
    similarity,
    expiresAt,
  };
}

function toVectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value)).join(',')}]`;
}

function normalizeBoolean(value: string | undefined): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function readNumberEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
