ALTER TABLE knowledge_eval_case
  ADD COLUMN IF NOT EXISTS last_run_hit_at_1 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_run_hit_at_3 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_run_recall_at_5 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_run_recall_at_10 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_run_retrieval_latency_ms INT,
  ADD COLUMN IF NOT EXISTS last_run_rerank_latency_ms INT;

