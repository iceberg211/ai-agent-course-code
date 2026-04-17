-- 004_migrate_documents.sql
-- 目的：knowledge_document 改为以 KB 为父资产（删 persona_id，加 knowledge_base_id）
-- 保留：filename / status / chunk_count / created_at
-- 新增：mime_type / file_size / source_type

-- 1. 添加新列
ALTER TABLE knowledge_document
  ADD COLUMN IF NOT EXISTS knowledge_base_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mime_type   TEXT,
  ADD COLUMN IF NOT EXISTS file_size   INT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'upload';

-- 2. 回填 knowledge_base_id：用 persona → 该 persona 的默认 KB 的映射
UPDATE knowledge_document d
SET knowledge_base_id = kb.id
FROM knowledge_base kb
WHERE kb.owner_persona_id = d.persona_id
  AND d.knowledge_base_id IS NULL;

-- 3. 回填完成后，把 knowledge_base_id 设为 NOT NULL
ALTER TABLE knowledge_document
  ALTER COLUMN knowledge_base_id SET NOT NULL;

-- 4. 创建 knowledge_base_id 索引
CREATE INDEX IF NOT EXISTS knowledge_document_kb_id_idx
  ON knowledge_document (knowledge_base_id);

-- 5. 删除 persona_id 列（此时已没用，知识库通过 KB 挂载定位 persona）
ALTER TABLE knowledge_document DROP COLUMN IF EXISTS persona_id;
