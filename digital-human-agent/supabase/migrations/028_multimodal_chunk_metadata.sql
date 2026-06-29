-- 多模态引用定位字段：图片、音频、视频片段可落到 chunk
ALTER TABLE knowledge_chunk
  ADD COLUMN IF NOT EXISTS source_asset_key TEXT,
  ADD COLUMN IF NOT EXISTS start_ms INT,
  ADD COLUMN IF NOT EXISTS end_ms INT;

CREATE INDEX IF NOT EXISTS knowledge_chunk_source_asset_key_idx
  ON knowledge_chunk (source_asset_key);

CREATE INDEX IF NOT EXISTS knowledge_chunk_media_time_idx
  ON knowledge_chunk (document_id, start_ms, end_ms);
