-- 003_knowledge_base.sql
-- 目的：引入 knowledge_base 独立资产 + persona ↔ KB 多对多挂载表
-- 并为每个存量 persona 生成一个"默认知识库"占位

-- 1. knowledge_base 表
CREATE TABLE IF NOT EXISTS knowledge_base (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  owner_persona_id  UUID REFERENCES persona(id) ON DELETE SET NULL,
  retrieval_config  JSONB NOT NULL DEFAULT '{"threshold":0.6,"stage1TopK":20,"finalTopK":5,"rerank":true}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_base_owner_persona_id_idx
  ON knowledge_base (owner_persona_id);

-- 2. persona ↔ knowledge_base 多对多表
CREATE TABLE IF NOT EXISTS persona_knowledge_base (
  persona_id         UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  knowledge_base_id  UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_id, knowledge_base_id)
);

CREATE INDEX IF NOT EXISTS persona_knowledge_base_kb_id_idx
  ON persona_knowledge_base (knowledge_base_id);

-- 3. 为每个存量 persona 创建默认 KB（幂等：只有当该 persona 还没有 owner KB 时才创建）
INSERT INTO knowledge_base (name, description, owner_persona_id)
SELECT
  p.name || ' 默认知识库',
  '从旧数据结构迁移：' || p.name,
  p.id
FROM persona p
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base kb WHERE kb.owner_persona_id = p.id
);

-- 4. 建立 persona ↔ 自己默认 KB 的挂载关系（幂等）
INSERT INTO persona_knowledge_base (persona_id, knowledge_base_id)
SELECT kb.owner_persona_id, kb.id
FROM knowledge_base kb
WHERE kb.owner_persona_id IS NOT NULL
ON CONFLICT (persona_id, knowledge_base_id) DO NOTHING;
