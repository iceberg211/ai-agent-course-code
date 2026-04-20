-- 009_persona_rag_policy.sql
-- 为 persona 表添加 rag_policy JSONB 列，存储 persona 级 RAG 编排策略。
-- 兼容：已有行 rag_policy 为 NULL，业务层读取时降级使用 DEFAULT_RAG_POLICY。

ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS rag_policy JSONB;

COMMENT ON COLUMN persona.rag_policy IS
  'Persona 级 RAG 编排策略（schemaVersion=1）：
   - minConfidence: 低置信度判定阈值，低于此值可触发 fallback（默认 0.45）
   - queryRewrite: 是否开启多轮改写，以及使用多少轮历史（默认关闭）
   - multiHop: 是否开启复杂问题拆解多跳检索（默认关闭）
   - webFallback: 联网 fallback 策略，默认 never
   NULL 时由业务层降级使用默认值。';
