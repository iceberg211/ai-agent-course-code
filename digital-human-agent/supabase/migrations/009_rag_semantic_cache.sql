-- 009_rag_semantic_cache.sql
-- 目的：
-- 1) 为 RAG 语义缓存提供真实 PostgreSQL 后端
-- 2) 缓存对象限定为检索候选、压缩上下文或重排后的 chunk id 列表
-- 3) 通过 persona、知识库 fingerprint、检索配置、模型、策略和索引版本隔离缓存
-- 4) 当前应用默认不启用缓存，只有显式配置后才读写该表

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_semantic_cache (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key                           TEXT NOT NULL UNIQUE,
  persona_id                          UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  normalized_query_hash               TEXT NOT NULL,
  query                               TEXT NOT NULL,
  query_embedding                     VECTOR(1024) NOT NULL,
  mounted_knowledge_base_ids          UUID[] NOT NULL DEFAULT '{}',
  mounted_knowledge_base_fingerprints TEXT[] NOT NULL DEFAULT '{}',
  retrieval_config                    JSONB NOT NULL,
  backend                             JSONB NOT NULL,
  models                              JSONB NOT NULL,
  strategy_flags                      JSONB NOT NULL,
  index_versions                      JSONB NOT NULL,
  payload                             JSONB NOT NULL,
  expires_at                          TIMESTAMPTZ NOT NULL,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_semantic_cache_persona_expires_idx
  ON rag_semantic_cache (persona_id, expires_at);

CREATE INDEX IF NOT EXISTS rag_semantic_cache_query_hash_idx
  ON rag_semantic_cache (normalized_query_hash);

CREATE INDEX IF NOT EXISTS rag_semantic_cache_embedding_idx
  ON rag_semantic_cache
  USING ivfflat (query_embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION match_rag_semantic_cache(
  p_persona_id UUID,
  p_query_embedding VECTOR(1024),
  p_mounted_knowledge_base_fingerprints TEXT[],
  p_retrieval_config JSONB,
  p_models JSONB,
  p_strategy_flags JSONB,
  p_index_versions JSONB,
  p_min_similarity DOUBLE PRECISION DEFAULT 0.92,
  p_match_count INT DEFAULT 1
)
RETURNS TABLE (
  cache_key TEXT,
  payload JSONB,
  similarity DOUBLE PRECISION,
  expires_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    c.cache_key,
    c.payload,
    1 - (c.query_embedding <=> p_query_embedding) AS similarity,
    c.expires_at
  FROM rag_semantic_cache c
  WHERE c.persona_id = p_persona_id
    AND c.expires_at > now()
    AND c.mounted_knowledge_base_fingerprints = p_mounted_knowledge_base_fingerprints
    AND c.retrieval_config = p_retrieval_config
    AND c.models = p_models
    AND c.strategy_flags = p_strategy_flags
    AND c.index_versions = p_index_versions
    AND 1 - (c.query_embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY c.query_embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$$;
