-- 文档处理任务基础表：先支持上传异步化和任务状态可见
CREATE TABLE IF NOT EXISTS document_task (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID REFERENCES knowledge_document(id) ON DELETE SET NULL,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  job_id           TEXT,
  task_type        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  stage            TEXT NOT NULL DEFAULT 'uploaded',
  progress         INT NOT NULL DEFAULT 0,
  attempt          INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 3,
  error            TEXT,
  metadata         JSONB,
  checkpoint_data  JSONB,
  ingest_run_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_task_knowledge_status_idx
  ON document_task (knowledge_base_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS document_task_document_idx
  ON document_task (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_task_ingest_run_idx
  ON document_task (ingest_run_id);

CREATE TABLE IF NOT EXISTS document_task_step (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES document_task(id) ON DELETE CASCADE,
  document_id       UUID REFERENCES knowledge_document(id) ON DELETE SET NULL,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  step              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  attempt           INT NOT NULL DEFAULT 0,
  input_hash        TEXT,
  output_hash       TEXT,
  checkpoint        JSONB,
  error             TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_task_step_task_idx
  ON document_task_step (task_id, step);

CREATE INDEX IF NOT EXISTS document_task_step_document_idx
  ON document_task_step (document_id, created_at DESC);
