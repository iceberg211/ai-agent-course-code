-- 008_retrieval_config_hybrid.sql
-- 目的：为 hybrid/keyword 检索预留稳定的 retrieval_config 契约。
-- 当前代码仍以 vector 检索为实际执行路径；这些字段先用于持久化、DTO、前端配置和 trace 输入。

ALTER TABLE knowledge_base
  ALTER COLUMN retrieval_config SET DEFAULT '{
    "retrievalMode": "vector",
    "threshold": 0.6,
    "stage1TopK": 20,
    "vectorTopK": 20,
    "keywordTopK": 20,
    "finalTopK": 5,
    "rerank": true,
    "fusion": {
      "method": "rrf",
      "rrfK": 60,
      "vectorWeight": 1,
      "keywordWeight": 1
    }
  }'::JSONB;

UPDATE knowledge_base
SET retrieval_config =
  retrieval_config
  || jsonb_build_object(
    'retrievalMode', COALESCE(retrieval_config->>'retrievalMode', 'vector'),
    'threshold', COALESCE((retrieval_config->>'threshold')::numeric, 0.6),
    'stage1TopK', COALESCE((retrieval_config->>'stage1TopK')::int, 20),
    'vectorTopK', COALESCE(
      (retrieval_config->>'vectorTopK')::int,
      (retrieval_config->>'stage1TopK')::int,
      20
    ),
    'keywordTopK', COALESCE((retrieval_config->>'keywordTopK')::int, 20),
    'finalTopK', COALESCE((retrieval_config->>'finalTopK')::int, 5),
    'rerank', COALESCE((retrieval_config->>'rerank')::boolean, true),
    'fusion',
      '{
        "method": "rrf",
        "rrfK": 60,
        "vectorWeight": 1,
        "keywordWeight": 1
      }'::JSONB
      || COALESCE(retrieval_config->'fusion', '{}'::JSONB)
  )
WHERE retrieval_config IS NOT NULL;
