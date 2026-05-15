-- 010_rag_graph_index.rollback.sql
-- 目的：
-- 1) 回退 RAG 图谱派生索引 schema
-- 2) 只删除派生索引表，不影响知识库主数据、chunk 和 embedding

DROP TABLE IF EXISTS rag_graph_edge;
DROP TABLE IF EXISTS rag_graph_node;
DROP TABLE IF EXISTS rag_graph_index_status;
