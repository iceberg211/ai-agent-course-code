ALTER TABLE knowledge_document
  ADD COLUMN IF NOT EXISTS processing_stage text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE knowledge_document
SET processing_stage = CASE
  WHEN status = 'failed' THEN 'failed'
  WHEN status = 'processing' THEN 'embedding'
  WHEN status = 'pending' THEN 'uploaded'
  ELSE 'completed'
END
WHERE processing_stage IS NULL OR processing_stage = 'completed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_processing_stage_check'
  ) THEN
    ALTER TABLE knowledge_document
      ADD CONSTRAINT knowledge_document_processing_stage_check
      CHECK (
        processing_stage IN (
          'uploaded',
          'parsing',
          'chunking',
          'embedding',
          'keyword_indexing',
          'graph_indexing',
          'completed',
          'failed'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_knowledge_document_status_created_at
  ON knowledge_document(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_processing_stage
  ON knowledge_document(processing_stage);

ALTER TABLE conversation_message
  ADD COLUMN IF NOT EXISTS citations jsonb,
  ADD COLUMN IF NOT EXISTS rag_trace jsonb,
  ADD COLUMN IF NOT EXISTS latency_ms int,
  ADD COLUMN IF NOT EXISTS feedback text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversation_message_feedback_check'
  ) THEN
    ALTER TABLE conversation_message
      ADD CONSTRAINT conversation_message_feedback_check
      CHECK (feedback IS NULL OR feedback IN ('up', 'down'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_conversation_message_turn_id
  ON conversation_message(turn_id);
