-- 012_rag_parent_child_index.rollback.sql
-- 目的：
-- 1) 回退 Parent-Child 派生索引 schema
-- 2) 不删除原始 knowledge_document / knowledge_chunk 数据

DROP TABLE IF EXISTS rag_parent_chunk_child;
DROP TABLE IF EXISTS rag_parent_chunk;
DROP TABLE IF EXISTS rag_parent_chunk_index_status;
