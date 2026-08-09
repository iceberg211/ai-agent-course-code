-- 添加角色字段，缺省为 user
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';

-- 创建 API Key 管理表
CREATE TABLE IF NOT EXISTS api_key (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  key_hash    TEXT NOT NULL,
  key_prefix  VARCHAR(16) NOT NULL,
  key_last_four VARCHAR(4) NOT NULL,
  user_id     UUID REFERENCES app_user(id) ON DELETE CASCADE,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 若 api_key 表已存在，则升级字段以防遗漏
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_hash TEXT;
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(16);
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_last_four VARCHAR(4);

-- 添加查询索引
CREATE INDEX IF NOT EXISTS api_key_prefix_idx ON api_key (key_prefix);
CREATE INDEX IF NOT EXISTS api_key_user_active_idx ON api_key (user_id, is_active);
