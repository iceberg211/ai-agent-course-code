-- 009_rag_semantic_cache.rollback.sql
-- 目的：
-- 1) 回退 RAG 语义缓存 schema
-- 2) 删除默认关闭的缓存表与 RPC
-- 3) 不删除 vector 扩展，因为知识库向量表仍依赖该扩展

DROP FUNCTION IF EXISTS match_rag_semantic_cache(
  UUID,
  VECTOR(1024),
  TEXT[],
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  DOUBLE PRECISION,
  INT
);

DROP TABLE IF EXISTS rag_semantic_cache;
