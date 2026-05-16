ALTER TABLE knowledge_document
  ADD COLUMN IF NOT EXISTS graph_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS graph_sync_error text,
  ADD COLUMN IF NOT EXISTS graph_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_graph_sync_status_check'
  ) THEN
    ALTER TABLE knowledge_document
      ADD CONSTRAINT knowledge_document_graph_sync_status_check
      CHECK (graph_sync_status IN ('pending', 'indexed', 'failed', 'skipped'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_knowledge_document_graph_sync_status
  ON knowledge_document(graph_sync_status);
