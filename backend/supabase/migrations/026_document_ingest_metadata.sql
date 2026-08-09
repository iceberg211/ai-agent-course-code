-- 文档摄入中间产物与处理批次元数据
ALTER TABLE knowledge_document
  ADD COLUMN IF NOT EXISTS original_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS markdown_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS parse_result_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS chunk_manifest_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS parse_strategy TEXT,
  ADD COLUMN IF NOT EXISTS parser_version TEXT,
  ADD COLUMN IF NOT EXISTS asset_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_ingest_run_id UUID;

CREATE INDEX IF NOT EXISTS knowledge_document_current_ingest_run_idx
  ON knowledge_document (current_ingest_run_id);

CREATE INDEX IF NOT EXISTS knowledge_document_parse_strategy_idx
  ON knowledge_document (parse_strategy);
