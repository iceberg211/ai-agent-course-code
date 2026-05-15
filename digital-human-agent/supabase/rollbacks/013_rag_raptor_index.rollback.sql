-- 013_rag_raptor_index.rollback.sql
-- 目的：
-- 1) 回退 RAPTOR 递归摘要树派生索引 schema
-- 2) 只删除派生索引表，不影响知识库、文档、chunk、embedding 和 vector 扩展

DROP TABLE IF EXISTS rag_raptor_edge;
DROP TABLE IF EXISTS rag_raptor_node;
DROP TABLE IF EXISTS rag_raptor_index_status;
