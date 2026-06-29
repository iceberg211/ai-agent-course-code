-- Create document_task table
CREATE TABLE IF NOT EXISTS document_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID,
  knowledge_base_id UUID NOT NULL,
  job_id VARCHAR(255),
  task_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  stage VARCHAR(50) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  error TEXT,
  checkpoint_data JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create document_asset table
CREATE TABLE IF NOT EXISTS document_asset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  knowledge_base_id UUID NOT NULL,
  asset_type VARCHAR(50) NOT NULL,
  mime_type VARCHAR(100),
  filename VARCHAR(255),
  storage_key VARCHAR(512) NOT NULL,
  url TEXT,
  page_no INT,
  start_ms INT,
  end_ms INT,
  caption TEXT,
  ocr_text TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add S3 storage columns to knowledge_document
ALTER TABLE knowledge_document 
  ADD COLUMN IF NOT EXISTS original_storage_key VARCHAR(512),
  ADD COLUMN IF NOT EXISTS markdown_storage_key VARCHAR(512),
  ADD COLUMN IF NOT EXISTS parse_strategy VARCHAR(50),
  ADD COLUMN IF NOT EXISTS parser_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS asset_count INT NOT NULL DEFAULT 0;
