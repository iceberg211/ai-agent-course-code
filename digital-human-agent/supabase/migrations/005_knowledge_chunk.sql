-- 005_knowledge_chunk.sql
-- 目的：
-- 1) 把 persona_knowledge rename 为 knowledge_chunk（名字更直觉）
-- 2) 加 enabled（驱动启用/禁用）、char_count（GENERATED 列）
-- 3) 删除 persona_id（通过 document → kb 反查即可）
-- 4) 索引重建：向量索引、document_id 索引

-- 1. 重命名
ALTER TABLE IF EXISTS persona_knowledge RENAME TO knowledge_chunk;

-- 2. 加 enabled 列
ALTER TABLE knowledge_chunk
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- 3. 加 char_count GENERATED 列
-- 注意：GENERATED 列写入操作会被 PG 拒绝（insert 必须用 DEFAULT），entity 层需要 insert:false,update:false
ALTER TABLE knowledge_chunk
  ADD COLUMN IF NOT EXISTS char_count INT
    GENERATED ALWAYS AS (char_length(content)) STORED;

-- 4. 删除 persona_id（旧结构冗余列）
ALTER TABLE knowledge_chunk DROP COLUMN IF EXISTS persona_id;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS knowledge_chunk_document_id_idx
  ON knowledge_chunk (document_id);

-- 向量索引：幂等创建
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'knowledge_chunk'
      AND indexname = 'knowledge_chunk_embedding_idx'
  ) THEN
    EXECUTE 'CREATE INDEX knowledge_chunk_embedding_idx ON knowledge_chunk '
         || 'USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
  END IF;
END
$$;
