CREATE TABLE IF NOT EXISTS memory_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  department TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'department', 'company')),
  category TEXT NOT NULL DEFAULT 'preference'
    CHECK (category IN ('preference', 'profile', 'business_context', 'task_goal', 'conversation_summary')),
  content TEXT NOT NULL,
  source_conversation_id UUID,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  expires_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_record_owner_updated
  ON memory_record(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_record_department_visibility
  ON memory_record(department, visibility);

CREATE INDEX IF NOT EXISTS idx_memory_record_expires_at
  ON memory_record(expires_at);

CREATE OR REPLACE FUNCTION set_memory_record_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memory_record_updated_at ON memory_record;
CREATE TRIGGER trg_memory_record_updated_at
BEFORE UPDATE ON memory_record
FOR EACH ROW
EXECUTE FUNCTION set_memory_record_updated_at();

