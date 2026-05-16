# Digital Human Agent — RAG 当前状态与剩余事项

> 更新日期：2026-05-16
> 目标：删掉已经完成的长篇计划，只保留当前事实、剩余动作和后续方向。

## 当前结论

RAG 主流程已经不是空方案，基础链路已经落地。当前重点不再是重写架构，而是把少量环境和发布动作做完，再继续做质量迭代。

当前主流程可以概括为：

```text
用户 query
  -> 路由与检索策略判断
  -> Query Rewrite / 多查询
  -> 多路召回：pgvector + keyword/ES + 可选 Graph
  -> 合并、去重、RRF 融合
  -> qwen3-rerank / fallback rerank
  -> 证据评估
  -> 高质量上下文进入大模型
  -> 生成回答
```

核心原则保持不变：不要把所有召回结果直接塞给大模型，要先筛选、排序、去重，只把有价值的证据放入上下文。

## 已完成

### P0 主链路

已完成，不再作为开发任务展开。

- `retrieval_strategy` 已接入 LangGraph，并会影响 vector、keyword、exact phrase、web、graph 等检索行为。
- `needRetrieval=false` 时会跳过知识库检索、证据评估和 web fallback。
- Multi-Query Hybrid Retrieval 已接入：LLM 生成多角度 query，每条 query 分别进入 pgvector 与 keyword/ES 通道，再合并去重。
- RerankerProvider 已抽象，支持 DashScope `qwen3-rerank`，并保留 LLM JSON fallback。
- 评估脚本已具备 golden set、fixture、live keyword 和完整 live eval 入口。
- ES v2、backfill、alias switch、rollback 脚本已存在；`ensure` 不再被当成自动迁移。

### P1 基础增强

已完成或已以默认关闭方式接入，不再作为主线任务展开。

- HyDE。
- 多查询数量控制。
- Lost-in-the-Middle 排列优化。
- 上下文压缩。
- chunk context expansion。
- Parent-Child 派生索引与 backfill 入口。
- Semantic cache key、store、migration、rollback，默认关闭。

### PostgreSQL Graph RAG 基础版

已完成最小可运行主路径。

- PostgreSQL 图谱派生索引已接入。
- `graph:backfill` 命令已恢复并可执行。
- `KnowledgeGraphRetriever` 已接入检索链路。
- `ENABLE_GRAPH_RETRIEVAL=true` 时，关系类问题可以进入 Graph 通道。
- `rag:smoke:graph` 已验证真实 DB Graph 检索。
- `rag:smoke:graph-answer` 已用 `qwen-max` 完成真实 DB + 真实模型的回答主路径验证。

## 仍需处理

### 1. ES v2 发布动作

这是当前最明确的剩余 P0 发布动作。代码和脚本已有，剩下是环境执行。

建议顺序：

```bash
pnpm es:index:ensure
pnpm es:backfill -- --dry-run
pnpm es:backfill
pnpm es:alias:switch -- --from=v1 --to=v2 --dry-run
pnpm es:alias:switch -- --from=v1 --to=v2
```

注意：

- v2 回填成功前不要正式切 alias。
- dry-run 输出 `ready=false` 时先处理原因。
- 切换后再跑一次检索评估和 smoke。

### 2. 完整 live eval

发布前建议再跑一次完整 live eval：

```bash
pnpm eval:rag -- --allow-model-calls
```

这个命令可能把真实知识库候选内容发送到当前模型服务，所以必须在明确允许模型调用后执行。

### 3. Graph 质量迭代

Graph RAG 基础链路已经跑通，后续重点是质量，不是换库。

下一步建议：

- 增加 Graph eval case。
- 优化实体抽取。
- 优化关系去重。
- 优化图谱证据排序。
- 观察 `retrievalStrategy.useGraph`、`graphEvidenceCount`、citation 质量。

### 4. Parent-Child 与 Semantic Cache 启用

这两项已有基础实现，但默认不应贸然打开。

启用前需要确认：

- migration 已执行。
- backfill 已完成。
- live 检索质量没有下降。
- cache key 中包含 persona、知识库 fingerprint、retrieval config、模型、reranker、web 与 graph 策略信息。

## 暂不推进

这些不属于当前主线：

- Neo4j：当前 PostgreSQL Graph RAG 已能支撑基础关系检索，Neo4j 后续单独立项。
- RAPTOR：当前只有 schema、tree plan 和 dry-run 前置层，还没有摘要生成、embedding 写入和检索接入。
- 更复杂的 Self-RAG / Corrective RAG：等主链路和 Graph 质量稳定后再评估。

## 常用验证命令

```bash
pnpm test --runInBand
pnpm build
pnpm eval:rag:validate
pnpm eval:rag:fixture
pnpm eval:rag:live-keyword
pnpm rag:smoke:basic-answer -- --timeout-ms=180000
pnpm rag:smoke:graph
pnpm rag:smoke:graph-answer -- --fixture-sanitized --model-name=qwen-max --reranker-provider=dashscope --reranker-model=qwen3-vl-rerank --timeout-ms=60000
pnpm rag:smoke:graph-answer -- --i-understand-real-content-model-call --model-name=qwen-max --reranker-provider=dashscope --reranker-model=qwen3-vl-rerank --timeout-ms=300000
git diff --check
```

## 当前下一步

学习阶段优先用最小 smoke 把主链路跑清楚；ES v2、Neo4j、RAPTOR 都作为后续独立阶段处理。

## Basic RAG 最小主链路 smoke（2026-05-16 16:52）

本轮按学习阶段目标收敛：先把链路跑清楚，不继续扩生产级细节。新增 `pnpm rag:smoke:basic-answer`，直接复用现有 `KnowledgeSearchService` 与 `AnswerGenerationService`，不改 LangGraph 主流程。

### 当前最小主链路

1. 自动选择已有 indexed Graph evidence 的 persona。
2. 自动生成一个关系类问题。
3. 用固定 basic strategy 调用 `KnowledgeSearchService.retrieveForPersonaWithStages()`。
4. 可用通道同时尝试召回：PostgreSQL pgvector、关键词检索、PostgreSQL Graph。
5. 跳过 Query Rewrite、HyDE、Rerank、Web fallback，只保留最小检索与生成。
6. 将 stage2 evidence 传给 `AnswerGenerationService.generate()`，用 `qwen-max` 生成答案。

### 本轮结果

- `pnpm rag:smoke:basic-answer -- --timeout-ms=180000` 退出码 0。
- 输出 `status=ok`、`llmModel=qwen-max`、`modelCalls=true`、`blockedReason=null`。
- 本次真实问题：`面向法务角色的系统讲解提纲和一、系统定位的包含子主题关系是什么？`
- 证据统计：`stage1=3`、`stage2=3`、`vector=3`、`keyword=1`、`graph=2`、`graphEvidence=10`。
- 通道状态：`vector=used(pgvector)`、`keyword=used(pg)`、`graph=used(postgres-graph-index)`。
- ES：当前 `HYBRID_KEYWORD_BACKEND=pg`，未启用 ES；启动时仍有 ES 连接警告，但不影响 basic smoke。
- Neo4j：本轮未接入，smoke 中明确记录为 `not-implemented-in-current-smoke`；如后续接入，应使用 `@langchain/community` 的 `Neo4jGraph`，并先确认 `neo4j-driver` 依赖。

### 本轮命令记录

| 命令 | 退出码 | 结果 |
|------|--------|------|
| `pnpm test --runInBand`（编辑前基线） | 0 | 68 个测试文件、235 个测试通过 |
| `pnpm build`（编辑前基线） | 0 | 构建通过 |
| `pnpm test --runInBand -- knowledge-content/graph/knowledge-graph-and-raptor-script-inventory.spec.ts` | 0 | 1 个测试文件、7 个测试通过 |
| `pnpm build` | 0 | 构建通过 |
| `pnpm rag:preflight -- --skip-es --check-derived-direct --check-pooler-candidates` | 0 | runtime DB 与 aws-1 pooler 可用；derived direct 仍失败；ES 检查按参数跳过 |
| `pnpm rag:smoke:basic-answer -- --timeout-ms=180000` | 0 | 真实 DB + pgvector + PG keyword + PostgreSQL Graph + qwen-max 主链路通过 |
| `pnpm test --runInBand` | 0 | 68 个测试文件、236 个测试通过 |
| `pnpm build`（最终复跑） | 0 | 构建通过 |
| 前端 `pnpm type-check` | 0 | Vue 类型检查通过，未修改前端代码 |
| 前端 `pnpm build` | 0 | Vite build 通过；存在 chunk size warning |
| `git diff --check` | 0 | 未发现空白格式问题 |

### 下一步建议

1. 先用这个 basic smoke 多跑几个真实问题，观察 evidence 是否正确，不急着扩 RAPTOR/Milvus。
2. 如要验证关键词精确召回，再单独启用 ES 并跑同一 smoke，对比 `channelStatus.elastic`。
3. 如要接 Neo4j，先做最小派生图写入和只读 smoke，再考虑图谱质量。
