-- 兼容早期 document_task 迁移：补齐任务步骤、任务元数据和索引
ALTER TABLE document_task
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS ingest_run_id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE document_task
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN stage SET DEFAULT 'uploaded';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'document_task_document_id_fkey'
      AND table_name = 'document_task'
  ) THEN
    ALTER TABLE document_task
      ADD CONSTRAINT document_task_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES knowledge_document(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'document_task_knowledge_base_id_fkey'
      AND table_name = 'document_task'
  ) THEN
    ALTER TABLE document_task
      ADD CONSTRAINT document_task_knowledge_base_id_fkey
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS document_task_knowledge_status_idx
  ON document_task (knowledge_base_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS document_task_document_idx
  ON document_task (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_task_ingest_run_idx
  ON document_task (ingest_run_id);

CREATE TABLE IF NOT EXISTS document_task_step (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES document_task(id) ON DELETE CASCADE,
  document_id UUID REFERENCES knowledge_document(id) ON DELETE SET NULL,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt INT NOT NULL DEFAULT 0,
  input_hash TEXT,
  output_hash TEXT,
  checkpoint JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_task_step_task_idx
  ON document_task_step (task_id, step);

CREATE INDEX IF NOT EXISTS document_task_step_document_idx
  ON document_task_step (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_asset_document_idx
  ON document_asset (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_asset_knowledge_type_idx
  ON document_asset (knowledge_base_id, asset_type, created_at DESC);
