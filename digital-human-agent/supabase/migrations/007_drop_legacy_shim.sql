-- 007_drop_legacy_shim.sql
-- 目的：删除 Phase 1 的 match_knowledge_legacy 过渡 shim。
-- Phase 2 结束后 AgentService 已切到 retrieveForPersona，直接调新 match_knowledge RPC，
-- 不再需要 persona_id → kb_ids 的 SQL 级翻译。

DROP FUNCTION IF EXISTS match_knowledge_legacy(VECTOR, UUID, FLOAT, INT);
