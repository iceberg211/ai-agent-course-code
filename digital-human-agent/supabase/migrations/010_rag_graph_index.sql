-- 010_rag_graph_index.sql
-- 目的：
-- 1) 为 RAG 图谱派生索引提供 PostgreSQL 基础表
-- 2) 记录每个 document 的图谱索引状态，避免 failed/stale 数据进入后续检索
-- 3) 用稳定 key 保证节点和关系幂等写入
-- 4) 当前只提供派生索引基础设施，不默认启用 GraphRetriever

CREATE TABLE IF NOT EXISTS rag_graph_index_status (
  document_id       UUID PRIMARY KEY REFERENCES knowledge_document(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'indexed', 'failed', 'stale')),
  extractor_version TEXT NOT NULL,
  schema_version    TEXT NOT NULL,
  entity_count      INT NOT NULL DEFAULT 0,
  relation_count    INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  indexed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_graph_index_status_status_idx
  ON rag_graph_index_status (status, extractor_version, schema_version);

CREATE TABLE IF NOT EXISTS rag_graph_node (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key          TEXT NOT NULL UNIQUE,
  node_type         TEXT NOT NULL
                    CHECK (node_type IN ('Entity', 'Event', 'Topic', 'Document', 'Chunk')),
  display_name      TEXT NOT NULL,
  normalized_name   TEXT NOT NULL,
  entity_type       TEXT,
  document_id       UUID REFERENCES knowledge_document(id) ON DELETE CASCADE,
  chunk_id          UUID REFERENCES knowledge_chunk(id) ON DELETE CASCADE,
  aliases           TEXT[] NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_graph_node_type_name_idx
  ON rag_graph_node (node_type, normalized_name);

CREATE INDEX IF NOT EXISTS rag_graph_node_document_idx
  ON rag_graph_node (document_id);

CREATE TABLE IF NOT EXISTS rag_graph_edge (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_key          TEXT NOT NULL UNIQUE,
  source_node_id    UUID NOT NULL REFERENCES rag_graph_node(id) ON DELETE CASCADE,
  target_node_id    UUID NOT NULL REFERENCES rag_graph_node(id) ON DELETE CASCADE,
  relation_type     TEXT NOT NULL,
  relation_label    TEXT,
  document_id       UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  chunk_id          UUID REFERENCES knowledge_chunk(id) ON DELETE SET NULL,
  extractor_version TEXT NOT NULL,
  schema_version    TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0,
  evidence_text     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_graph_edge_document_idx
  ON rag_graph_edge (document_id, extractor_version, schema_version);

CREATE INDEX IF NOT EXISTS rag_graph_edge_relation_idx
  ON rag_graph_edge (relation_type);

CREATE INDEX IF NOT EXISTS rag_graph_edge_source_target_idx
  ON rag_graph_edge (source_node_id, target_node_id);
