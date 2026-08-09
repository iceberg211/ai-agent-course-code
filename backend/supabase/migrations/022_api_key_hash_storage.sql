-- 将历史 API Key 存储升级为哈希结构。
-- 已存在的明文 key 无法安全补算哈希，统一置为失效，用户重新生成即可。
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_hash TEXT;
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(16);
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_last_four VARCHAR(4);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'api_key' AND column_name = 'key'
  ) THEN
    UPDATE api_key
    SET
      is_active = false,
      key_hash = COALESCE(key_hash, 'legacy-invalid:' || id::text),
      key_prefix = COALESCE(key_prefix, LEFT(COALESCE(key, 'legacy_key'), 11)),
      key_last_four = COALESCE(key_last_four, RIGHT(COALESCE(key, '0000'), 4))
    WHERE key_hash IS NULL OR key_prefix IS NULL OR key_last_four IS NULL;
  ELSE
    UPDATE api_key
    SET
      is_active = false,
      key_hash = COALESCE(key_hash, 'legacy-invalid:' || id::text),
      key_prefix = COALESCE(key_prefix, 'legacy_key'),
      key_last_four = COALESCE(key_last_four, '0000')
    WHERE key_hash IS NULL OR key_prefix IS NULL OR key_last_four IS NULL;
  END IF;
END $$;

ALTER TABLE api_key ALTER COLUMN key_hash SET NOT NULL;
ALTER TABLE api_key ALTER COLUMN key_prefix SET NOT NULL;
ALTER TABLE api_key ALTER COLUMN key_last_four SET NOT NULL;

DROP INDEX IF EXISTS api_key_key_idx;
CREATE INDEX IF NOT EXISTS api_key_prefix_idx ON api_key (key_prefix);
CREATE INDEX IF NOT EXISTS api_key_user_active_idx ON api_key (user_id, is_active);

ALTER TABLE api_key DROP COLUMN IF EXISTS key;
