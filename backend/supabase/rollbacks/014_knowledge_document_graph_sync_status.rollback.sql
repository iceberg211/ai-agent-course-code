ALTER TABLE knowledge_document
  DROP CONSTRAINT IF EXISTS knowledge_document_graph_sync_status_check,
  DROP COLUMN IF EXISTS graph_synced_at,
  DROP COLUMN IF EXISTS graph_sync_error,
  DROP COLUMN IF EXISTS graph_sync_status;
