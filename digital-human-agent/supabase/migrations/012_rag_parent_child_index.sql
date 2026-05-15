-- 012_rag_parent_child_index.sql
-- 目的：
-- 1) 为 Parent-Child 检索提供 PostgreSQL 派生索引
-- 2) 记录每个 document 的 parent chunk 索引状态，避免 failed/stale 数据进入上下文扩展
-- 3) 保留小 chunk 到 parent chunk 的稳定映射，支持命中小块后回到大块上下文
-- 4) 当前只在 strategy.parentContext=true 时读取，不改变默认检索路径

CREATE TABLE IF NOT EXISTS rag_parent_chunk_index_status (
  document_id       UUID PRIMARY KEY REFERENCES knowledge_document(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'indexed', 'failed', 'stale')),
  index_version     TEXT NOT NULL,
  parent_count      INT NOT NULL DEFAULT 0,
  child_count       INT NOT NULL DEFAULT 0,
  max_parent_chars  INT NOT NULL DEFAULT 2000,
  max_child_chunks  INT NOT NULL DEFAULT 5,
  error_message     TEXT,
  indexed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_parent_chunk_index_status_status_idx
  ON rag_parent_chunk_index_status (status, index_version);

CREATE TABLE IF NOT EXISTS rag_parent_chunk (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_key        TEXT NOT NULL UNIQUE,
  document_id       UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  source            TEXT NOT NULL,
  category          TEXT,
  start_chunk_index INT NOT NULL,
  end_chunk_index   INT NOT NULL,
  content           TEXT NOT NULL,
  child_chunk_ids   UUID[] NOT NULL DEFAULT '{}',
  char_count        INT GENERATED ALWAYS AS (char_length(content)) STORED,
  index_version     TEXT NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_chunk_index <= end_chunk_index),
  UNIQUE (document_id, index_version, start_chunk_index, end_chunk_index)
);

CREATE INDEX IF NOT EXISTS rag_parent_chunk_document_idx
  ON rag_parent_chunk (document_id, index_version, start_chunk_index, end_chunk_index);

CREATE INDEX IF NOT EXISTS rag_parent_chunk_char_count_idx
  ON rag_parent_chunk (char_count);

CREATE INDEX IF NOT EXISTS rag_parent_chunk_child_ids_idx
  ON rag_parent_chunk USING GIN (child_chunk_ids);

CREATE TABLE IF NOT EXISTS rag_parent_chunk_child (
  parent_id      UUID NOT NULL REFERENCES rag_parent_chunk(id) ON DELETE CASCADE,
  chunk_id       UUID NOT NULL REFERENCES knowledge_chunk(id) ON DELETE CASCADE,
  document_id    UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  chunk_index    INT NOT NULL,
  index_version  TEXT NOT NULL,
  position       INT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS rag_parent_chunk_child_chunk_idx
  ON rag_parent_chunk_child (chunk_id, index_version);

CREATE INDEX IF NOT EXISTS rag_parent_chunk_child_document_idx
  ON rag_parent_chunk_child (document_id, chunk_index);
