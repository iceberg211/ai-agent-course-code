-- 添加角色字段，缺省为 user
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';

-- 创建 API Key 管理表
CREATE TABLE IF NOT EXISTS api_key (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  key         VARCHAR(255) UNIQUE NOT NULL,
  user_id     UUID REFERENCES app_user(id) ON DELETE CASCADE,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 添加查询索引
CREATE INDEX IF NOT EXISTS api_key_key_idx ON api_key (key);
