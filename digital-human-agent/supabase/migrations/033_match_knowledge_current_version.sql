-- 033_match_knowledge_current_version.sql
-- 目的：向量召回时排除非当前版本与已归档文档，避免依赖应用层后置过滤

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding  VECTOR(1024),
  p_kb_id          UUID,
  match_threshold  FLOAT,
  match_count      INT,
  p_user_id        UUID DEFAULT NULL,
  p_department     TEXT DEFAULT NULL,
  p_role           TEXT DEFAULT NULL,
  p_is_admin       BOOLEAN DEFAULT FALSE
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
    AND d.is_current_version = true
    AND d.archived_at IS NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
    AND (
      p_is_admin = true
      OR coalesce(c.security_level, 0) = 0
      OR (p_user_id IS NOT NULL AND p_user_id::text = ANY(coalesce(c.allowed_user_ids, ARRAY[]::text[])))
      OR (p_department IS NOT NULL AND p_department = ANY(coalesce(c.allowed_department_ids, ARRAY[]::text[])))
      OR (p_role IS NOT NULL AND p_role = ANY(coalesce(c.allowed_role_ids, ARRAY[]::text[])))
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
