-- 文档治理字段：标签、分类、权限、有效期、版本与归档
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS business_category TEXT;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'company';
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS version_group_id UUID;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS version_no INT DEFAULT 1;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS is_current_version BOOLEAN DEFAULT true;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE knowledge_document
SET
  tags = COALESCE(tags, '[]'::jsonb),
  visibility = COALESCE(visibility, 'company'),
  version_group_id = COALESCE(version_group_id, id),
  version_no = COALESCE(version_no, 1),
  is_current_version = COALESCE(is_current_version, true)
WHERE version_group_id IS NULL
   OR tags IS NULL
   OR visibility IS NULL
   OR version_no IS NULL
   OR is_current_version IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_document_tags_gin_idx ON knowledge_document USING GIN (tags);
CREATE INDEX IF NOT EXISTS knowledge_document_governance_idx
  ON knowledge_document (knowledge_base_id, is_current_version, archived_at, visibility, department);
CREATE INDEX IF NOT EXISTS knowledge_document_version_group_idx
  ON knowledge_document (version_group_id, version_no DESC);

-- 站内通知
CREATE TABLE IF NOT EXISTS notification (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES app_user(id) ON DELETE CASCADE,
  type        VARCHAR(64) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  message     TEXT,
  payload     JSONB DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_owner_read_idx
  ON notification (owner_id, read_at, created_at DESC);
