ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS owner_id text;

CREATE INDEX IF NOT EXISTS conversation_persona_owner_created_idx
  ON conversation (persona_id, owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_message_conversation_seq_idx
  ON conversation_message (conversation_id, seq);
