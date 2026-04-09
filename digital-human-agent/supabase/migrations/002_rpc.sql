CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding  VECTOR(1536),
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
    id,
    content,
    source,
    chunk_index,
    category,
    1 - (embedding <=> query_embedding) AS similarity
  FROM persona_knowledge
  WHERE persona_knowledge.persona_id = p_persona_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
