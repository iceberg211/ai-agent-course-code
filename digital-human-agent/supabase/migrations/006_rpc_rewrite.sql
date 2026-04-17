-- 006_rpc_rewrite.sql
-- 目的：
-- 1) 丢弃旧 match_knowledge（因为它引用了已经不存在的 persona_knowledge.persona_id，
--    以及返回行形状即将变化，不能 CREATE OR REPLACE）
-- 2) 定义新 match_knowledge(p_kb_id UUID, ...)
-- 3) 定义过渡 shim match_knowledge_legacy(p_persona_id UUID, ...)
--    内部 JOIN persona_knowledge_base 把 persona_id 翻译成 kb_ids
--    Phase 2 Agent/Service 切换完成后删除此 shim

-- 1. 丢弃旧函数
DROP FUNCTION IF EXISTS match_knowledge(VECTOR, UUID, FLOAT, INT);

-- 2. 新的单 KB 签名
CREATE FUNCTION match_knowledge(
  query_embedding  VECTOR(1024),
  p_kb_id          UUID,
  match_threshold  FLOAT,
  match_count      INT
)
RETURNS TABLE (
  id                UUID,
  content           TEXT,
  source            TEXT,
  chunk_index       INT,
  category          TEXT,
  similarity        FLOAT,
  knowledge_base_id UUID
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.content,
    c.source,
    c.chunk_index,
    c.category,
    1 - (c.embedding <=> query_embedding) AS similarity,
    d.knowledge_base_id
  FROM knowledge_chunk c
  JOIN knowledge_document d ON d.id = c.document_id
  WHERE d.knowledge_base_id = p_kb_id
    AND c.enabled = true
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 3. 过渡 shim：保 Phase 1 末老代码还能跑
-- Phase 2 切换完成后用 DROP FUNCTION match_knowledge_legacy(...) 清掉
CREATE FUNCTION match_knowledge_legacy(
  query_embedding  VECTOR(1024),
  p_persona_id     UUID,
  match_threshold  FLOAT,
  match_count      INT
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  source      TEXT,
  chunk_index INT,
  category    TEXT,
  similarity  FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.content,
    c.source,
    c.chunk_index,
    c.category,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunk c
  JOIN knowledge_document d ON d.id = c.document_id
  JOIN persona_knowledge_base pkb ON pkb.knowledge_base_id = d.knowledge_base_id
  WHERE pkb.persona_id = p_persona_id
    AND c.enabled = true
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
