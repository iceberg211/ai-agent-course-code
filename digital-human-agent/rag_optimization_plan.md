# Digital Human Agent RAG 当前状态

更新时间：2026-05-16

当前目标已经收敛为一件事：先跑通 Agentic RAG 的三路检索主流程。

```text
用户问题
  -> LangGraph 路由与 retrieval_strategy
  -> KnowledgeSearchService
  -> pgvector 语义检索
  -> Elasticsearch 关键词 / 术语 / 编号检索
  -> Neo4j 实体关系 / 层级 / 多跳关系检索
  -> 合并去重
  -> 可选 rerank
  -> 生成答案
```

## 当前结论

- PostgreSQL 仍是业务数据源和向量检索来源。
- Elasticsearch 只做关键词派生索引，不做主数据源。
- Neo4j 是当前唯一图谱通道。
- 旧的 PostgreSQL 图表方案已经从主线删除，不再保留 `graph:backfill`、`rag:smoke:graph*`、`rag_graph_*` migration 和 PG 图谱 retriever。
- `KnowledgeSearchService` 继续作为三路召回入口，但 trace 增加了 `graphBackend`，可以直接看到图谱通道是否为 `neo4j`。
- Elasticsearch 本地容器已经启动，`digital-human-knowledge-chunk-v2` 已回填 24 条 chunk，read/write alias 已切到 v2。
- Neo4j 已改为本地固定镜像 `digital-human-agent-neo4j:5.26.26`，容器已启动并完成回填。
- 真实三路 RAG smoke 已通过：`pgvector`、Elasticsearch、Neo4j 都有命中。

## 已保留

这些能力对 Agentic RAG 主流程仍有用，暂时保留：

- LangGraph RAG 主流程。
- `retrieval_strategy`。
- pgvector 语义检索。
- Elasticsearch keyword retriever、backfill、alias switch、alias rollback。
- Query Rewrite / Multi-Query。
- RerankerProvider 与 fallback。
- eval fixture / golden set 基础评估。
- Parent-Child、Semantic Cache、RAPTOR 前置脚本仍保留，但不是当前主线。

## 已删除或移出主线

- `docker-compose.elastic.yml` 和 `docker-compose.neo4j.yml` 已合并为 `docker-compose.rag.yml`。
- `graph:backfill` 已删除。
- `rag:smoke:graph`、`rag:smoke:graph-flow`、`rag:smoke:graph-answer`、`rag:smoke:basic-answer` 已删除。
- PostgreSQL 图谱 migration `010_rag_graph_index.sql` 和 rollback 已删除。
- PostgreSQL 图谱 sync / retriever / backfill 相关测试与脚本已删除。

PostgreSQL 图表方案之前的作用只是：在不启动 Neo4j 的情况下，先用 PG 表模拟图谱检索，验证“图谱证据能进入 RAG 上下文”。这对学习图谱检索有一点价值，但对当前目标来说会绕路，所以不再继续。

## 当前命令

基础设施：

```bash
pnpm rag:infra:up
pnpm rag:infra:down
pnpm es:up
pnpm es:down
pnpm neo4j:up
pnpm neo4j:down
pnpm rag:infra:up
pnpm rag:infra:down
```

回填与验证：

```bash
pnpm es:index:ensure
pnpm es:backfill
pnpm neo4j:prepare-image
pnpm neo4j:build
pnpm neo4j:backfill
NEO4J_GRAPH_ENABLED=true HYBRID_KEYWORD_BACKEND=elastic pnpm rag:smoke:agentic -- --query=React组件设计讲义
```

## 下一步

1. 用 3 到 5 个真实业务问题继续观察证据排序和答案质量。
2. 修正或增强 `graphEvidenceCount` 在最终 stage2 中的保留情况；当前 smoke 三路命中，但最终 topK 中图谱证据数量为 0。
3. 后续再决定是否优化图谱抽取质量、Cypher 查询能力和 `KnowledgeSearchService` 拆分。

## 本轮验证记录

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `docker compose -f docker-compose.rag.yml config` | 0 | 合并后的 ES / Kibana / Neo4j compose 配置有效 |
| `pnpm neo4j:backfill -- --dry-run` | 0 | Neo4j 回填命令可解析，dry-run 输出正常 |
| `pnpm test --runInBand -- knowledge-content/graph/neo4j-graph-retriever.service.spec.ts knowledge-content/graph/knowledge-graph-and-raptor-script-inventory.spec.ts knowledge-content/services/knowledge-document.service.spec.ts knowledge-content/services/knowledge-search.service.spec.ts knowledge-content/evaluation/rag-fixture-eval.spec.ts knowledge-content/evaluation/rag-eval-report.spec.ts agent/retrieval-strategy.utils.spec.ts agent/services/retrieval-strategy.service.spec.ts` | 0 | 8 个测试文件、49 个测试通过 |
| `pnpm test --runInBand` | 0 | 63 个测试文件、214 个测试通过 |
| `pnpm build` | 0 | 构建通过 |
| `pnpm eval:rag:fixture` | 0 | fixture eval 通过，hit@k、MRR、coverage 均为 1 |
| `git diff --check` | 0 | 未发现空白格式问题 |
| `pnpm es:up` | 0 | ES / Kibana 已通过 `docker-compose.rag.yml` 启动 |
| `curl -fsS 'http://127.0.0.1:9200/_cluster/health?pretty'` | 0 | ES 单节点集群健康状态为 yellow |
| `pnpm es:index:ensure` | 0 | v2 索引存在；alias 切换后不再出现指向不一致警告 |
| `pnpm es:backfill -- --dry-run` | 0 | 读取到真实 Supabase 连接和本机 ES 配置 |
| `pnpm es:backfill` | 0 | 回填 1 页、24 个 chunk；修正后写入 `digital-human-knowledge-chunk-v2` 具体索引 |
| `pnpm es:alias:switch -- --from=v1 --to=v2` | 1 | 第一次失败，发现回填写入旧 write alias，v2 文档数为 0 |
| `pnpm es:alias:switch -- --from=v1 --to=v2` | 0 | 修正回填写入目标索引后切换成功，read/write alias 均指向 v2 |
| `pnpm eval:rag:live-keyword` | 0 | 不调用模型的真实 keyword eval 通过，指标均为 1 |
| `pnpm rag:smoke:agentic -- --allow-partial` | 未执行 | 权限审核拦截：该命令可能把真实知识库候选内容发给外部模型服务 |
| `pnpm neo4j:up` | 1 | 默认 `neo4j:5.26-community` 拉取失败：`registry-1.docker.io/v2/: EOF` |
| `docker pull docker.m.daocloud.io/neo4j:5.26-community` | 1 | 镜像配置下载失败：`download failed after attempts=6: EOF` |
| `docker pull docker.m.daocloud.io/library/neo4j:5.26-community` | 1 | 镜像配置下载失败：`download failed after attempts=6: EOF` |
| `pnpm neo4j:up` 使用 `docker.1panel.live/neo4j:5.26-community` | 1 | 镜像源入口失败：`docker.1panel.live/v2/: EOF` |
| `curl -L https://dist.neo4j.org/neo4j-community-5.26.26-unix.tar.gz` | 0 | 官方 Neo4j 5.26.26 包可下载 |
| `pnpm neo4j:prepare-image` | 0 | 本地 Neo4j 镜像构建上下文已准备，`docker/neo4j/vendor/` 已被 git ignore |
| `pnpm neo4j:build` | 0 | 构建 `digital-human-agent-neo4j:5.26.26` 成功 |
| `pnpm neo4j:up` | 0 | Neo4j 5.26.26 容器启动成功，7474/7687 可访问 |
| `curl -fsS http://127.0.0.1:7474` | 0 | 返回 `neo4j_version=5.26.26` |
| `NEO4J_GRAPH_ENABLED=true pnpm neo4j:backfill` | 0 | 回填 1 页、11 个 document、24 个 chunk |
| `cypher-shell MATCH (n) RETURN labels(n), count(n)` | 0 | Neo4j 中有 `KnowledgeDocument=11`、`KnowledgeChunk=24`、`GraphNode=36` |
| `cypher-shell MATCH ()-[r]->() RETURN type(r), count(r)` | 0 | Neo4j 中有 `HAS_CHUNK=24`、`HAS_SUBTOPIC=13`、`MENTIONS=15` |
| `NEO4J_GRAPH_ENABLED=true HYBRID_KEYWORD_BACKEND=elastic pnpm rag:smoke:agentic -- --allow-partial` | 0 | 默认泛问题可跑通服务链路，但结果为 partial：keyword=7、vector=0、graph=0 |
| `NEO4J_GRAPH_ENABLED=true HYBRID_KEYWORD_BACKEND=elastic pnpm rag:smoke:agentic -- --query=React组件设计讲义` | 0 | 严格 smoke 通过：status=ok，vector=1、keyword=6、graph=1 |
| `pnpm test --runInBand -- knowledge-content/graph/neo4j-graph-retriever.service.spec.ts` | 0 | Neo4j retriever 定向测试通过 |
| `pnpm test --runInBand` | 0 | 63 个测试文件、214 个测试通过 |
| `pnpm build` | 0 | 构建通过 |
| `pnpm eval:rag:fixture` | 0 | fixture eval 通过，hit@k、MRR、coverage 均为 1 |
| `git diff --check` | 0 | 未发现空白格式问题 |

## 已完成修正

- ES 回填不再写当前 write alias，而是写 `ELASTICSEARCH_INDEX_VERSION` 对应的具体索引；普通文档同步仍然写 write alias。
- `docker-compose.rag.yml` 支持构建本地固定版 Neo4j 镜像 `digital-human-agent-neo4j:5.26.26`，不再依赖 Docker Hub 的 Neo4j 镜像层。
- `.env.example` 增加 `NEO4J_VERSION=5.26.26`、`NEO4J_BASE_IMAGE` 和 `NEO4J_IMAGE`。
- `scripts/smoke-rag-agentic.ts` 修复 `graphResultCount` 可选类型导致的 ts-node 编译失败。
- `Neo4jGraphRetrieverService` 修复 Cypher `LIMIT` 参数被传成浮点数的问题。

## 当前阻塞

- 当前没有阻塞三路主链路的问题。
- Neo4j 当前复用本机 ES 镜像里的 Java 运行时，日志会提示 Java 版本不是 Neo4j 官方推荐的 17/21；服务已可用，但后续可以换成更干净的 Java 21 基础镜像。
