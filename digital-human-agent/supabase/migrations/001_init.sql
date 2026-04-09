-- 启用 pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 角色配置
CREATE TABLE persona (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  speaking_style      TEXT,
  expertise           JSONB DEFAULT '[]',
  voice_id            TEXT,
  avatar_id           TEXT,
  system_prompt_extra TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- 会话
CREATE TABLE conversation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 对话消息
CREATE TABLE conversation_message (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  turn_id         UUID NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  seq             INT NOT NULL DEFAULT 0,
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed', 'interrupted', 'failed')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 知识文档（原始）
CREATE TABLE knowledge_document (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  chunk_count INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 知识片段 + 向量
CREATE TABLE persona_knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL,
  category    TEXT,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 元数据索引
CREATE INDEX ON persona_knowledge (persona_id);
CREATE INDEX ON conversation_message (conversation_id, created_at);
