-- 008_keyword_retrieval_index.sql
-- 目的：
-- 1) 为基于 ILIKE 的关键词检索准备 pg_trgm 索引
-- 2) 先在 PostgreSQL 内提供一个轻量 lexical retrieval 能力，
--    作为 Hybrid Retrieval 的基础版本
-- 3) 后续接入 ElasticSearch 后，保留上层 Hybrid Retrieval 编排，
--    只替换关键词检索器实现

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS knowledge_chunk_content_trgm_idx
  ON knowledge_chunk
  USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunk_source_trgm_idx
  ON knowledge_chunk
  USING gin (source gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunk_category_trgm_idx
  ON knowledge_chunk
  USING gin (category gin_trgm_ops);
