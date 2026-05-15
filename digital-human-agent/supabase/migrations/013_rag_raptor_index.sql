-- 013_rag_raptor_index.sql
-- 目的：
-- 1) 为 RAPTOR 递归摘要树提供 PostgreSQL 派生索引基础表
-- 2) 记录每个 knowledge base 的摘要树索引状态，避免 failed/stale 数据进入后续检索
-- 3) 保留 chunk 锚点和父子摘要边，确保高层摘要能回到原始证据
-- 4) 当前只提供默认关闭的前置索引，不默认启用 RAPTOR 检索

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_raptor_index_status (
  knowledge_base_id  UUID PRIMARY KEY REFERENCES knowledge_base(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'indexed', 'failed', 'stale')),
  summarizer_version TEXT NOT NULL,
  schema_version     TEXT NOT NULL,
  max_layer          INT NOT NULL DEFAULT 0,
  node_count         INT NOT NULL DEFAULT 0,
  error_message      TEXT,
  indexed_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_raptor_index_status_status_idx
  ON rag_raptor_index_status (status, summarizer_version, schema_version);

CREATE TABLE IF NOT EXISTS rag_raptor_node (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key           TEXT NOT NULL UNIQUE,
  knowledge_base_id  UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  layer              INT NOT NULL CHECK (layer >= 1),
  summary            TEXT NOT NULL,
  source_chunk_ids   UUID[] NOT NULL DEFAULT '{}',
  embedding          VECTOR(1024),
  summarizer_version TEXT NOT NULL,
  schema_version     TEXT NOT NULL,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_raptor_node_kb_layer_idx
  ON rag_raptor_node (knowledge_base_id, layer, summarizer_version, schema_version);

CREATE INDEX IF NOT EXISTS rag_raptor_node_source_chunks_idx
  ON rag_raptor_node USING GIN (source_chunk_ids);

CREATE INDEX IF NOT EXISTS rag_raptor_node_embedding_idx
  ON rag_raptor_node
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS rag_raptor_edge (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_node_id     UUID NOT NULL REFERENCES rag_raptor_node(id) ON DELETE CASCADE,
  child_node_id      UUID NOT NULL REFERENCES rag_raptor_node(id) ON DELETE CASCADE,
  knowledge_base_id  UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  relation_type      TEXT NOT NULL DEFAULT 'SUMMARIZES'
                     CHECK (relation_type = 'SUMMARIZES'),
  summarizer_version TEXT NOT NULL,
  schema_version     TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_node_id, child_node_id)
);

CREATE INDEX IF NOT EXISTS rag_raptor_edge_parent_idx
  ON rag_raptor_edge (parent_node_id);

CREATE INDEX IF NOT EXISTS rag_raptor_edge_child_idx
  ON rag_raptor_edge (child_node_id);
