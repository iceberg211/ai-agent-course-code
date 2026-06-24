ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS last_run_actual_answer TEXT;
ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS last_run_status VARCHAR(50) DEFAULT 'unrun';
ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS last_run_hit_rate DOUBLE PRECISION;
ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS last_run_recall DOUBLE PRECISION;
ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS last_run_error TEXT;
ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS user_review_status VARCHAR(20) DEFAULT 'unreviewed';
ALTER TABLE knowledge_eval_case ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
