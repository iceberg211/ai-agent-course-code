CREATE TABLE IF NOT EXISTS knowledge_eval_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  question text NOT NULL,
  expected_answer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_eval_case_kb_created_at
  ON knowledge_eval_case(knowledge_base_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_knowledge_eval_case_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_eval_case_updated_at ON knowledge_eval_case;
CREATE TRIGGER trg_knowledge_eval_case_updated_at
BEFORE UPDATE ON knowledge_eval_case
FOR EACH ROW
EXECUTE FUNCTION set_knowledge_eval_case_updated_at();
