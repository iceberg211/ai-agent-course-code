# digital-human-agent Agent 接手说明

这份文件给后续接手本项目的 Agent 使用。目标是先理解主链路，再做最小必要改动；不要把学习型项目直接扩大成生产级改造。

## 项目定位

`digital-human-agent` 是一个数字人问答后端，核心能力是：

- 角色管理与知识库挂载
- 文本问答与 WebSocket 会话
- ASR / TTS / 语音克隆
- 基于 LangGraph 的 RAG 编排
- 知识库文档摄入、向量检索、关键词检索、图谱检索

技术栈：

- `NestJS 11`
- `TypeORM`
- `PostgreSQL / Supabase / pgvector`
- `Elasticsearch`
- `Neo4j`
- `LangChain / LangGraph`
- `ws`

默认服务端口：`3001`

## 当前 RAG 主链路

当前项目的 RAG 主线已经跑通，三路检索都接入了：

- `pgvector`：语义相似度检索
- `Elasticsearch`：关键词、术语、标题、编号等精确匹配
- `Neo4j`：实体关系、层级关系、多跳关系补充

主流程可以按这条线理解：

```text
用户问题
-> ChatController / ConversationGateway
-> AgentService
-> LangGraph RAG Orchestrator
-> retrieval strategy / route / evidence evaluation
-> KnowledgeSearchService
-> query rewrite / HyDE
-> pgvector + Elasticsearch + Neo4j
-> fusion / rerank / context expansion
-> answer generation
-> 返回答案、引用和调试信息
```

读代码时建议按这个顺序：

1. `src/chat/chat.controller.ts`
2. `src/gateway/conversation.gateway.ts`
3. `src/agent/agent.service.ts`
4. `src/agent/orchestrators/langgraph-rag-orchestrator.service.ts`
5. `src/agent/langgraph/rag.graph.ts`
6. `src/knowledge-content/services/knowledge-search.service.ts`
7. `src/knowledge-content/services/knowledge-stage1-retrieval.service.ts`
8. `src/knowledge-content/elasticsearch`
9. `src/knowledge-content/graph`

## 常用命令

安装与启动：

```bash
pnpm install
pnpm start:dev
```

测试与构建：

```bash
pnpm test --runInBand
pnpm build
```

数据库：

```bash
pnpm db:migrate
```

RAG 基础设施：

```bash
pnpm rag:infra:up
pnpm rag:infra:down
```

也可以单独启停：

```bash
pnpm es:up
pnpm es:down
pnpm neo4j:up
pnpm neo4j:down
```

索引初始化与回填：

```bash
pnpm es:index:ensure
pnpm es:backfill
pnpm neo4j:backfill
```

Neo4j 本地镜像不存在时再构建：

```bash
pnpm neo4j:prepare-image
pnpm neo4j:build
```

RAG 运行检查：

```bash
pnpm rag:preflight
NEO4J_GRAPH_ENABLED=true HYBRID_KEYWORD_BACKEND=elastic pnpm rag:smoke:agentic -- --query=React组件设计讲义
```

`package.json` 里只保留日常入口。低频脚本仍保留在 `scripts/` 目录，需要时可直接用 `node -r ts-node/register -r tsconfig-paths/register ./scripts/<file>.ts` 执行。

## 本地 Docker 约定

当前项目需要的镜像是：

- `digital-human-agent-neo4j:5.26.26`
- `digital-human-agent-elasticsearch-ik:9.3.3`
- `docker.m.daocloud.io/kibana:9.3.3`
- `docker.m.daocloud.io/elasticsearch:9.3.3`

`docker/neo4j/vendor` 是本地构建 Neo4j 镜像时的临时目录，不应提交。已有镜像时，不需要保留 Neo4j 官方压缩包。

不要随手删除 Docker volume。Neo4j 和 ES 的数据在 volume 里，不在镜像里。

## 关键目录

- `src/agent`：Agent 编排、LangGraph RAG、答案生成、证据评估
- `src/chat`：HTTP 文本问答入口
- `src/gateway`：WebSocket 会话入口，处理语音、打断和流式返回
- `src/conversation`：会话与消息持久化
- `src/persona`：角色定义
- `src/knowledge`：知识库定义、检索配置、角色挂载关系
- `src/knowledge-content`：文档摄入、chunk、检索、回填、评估
- `src/knowledge-content/elasticsearch`：ES 索引、同步、回填、alias 工具
- `src/knowledge-content/graph`：Neo4j 图谱抽取、写入、检索
- `src/knowledge-content/cache`：RAG 语义缓存
- `src/asr`：ASR 能力
- `src/tts`：TTS 能力
- `src/voice-clone`：语音克隆接口
- `src/digital-human`：数字人 provider 抽象
- `supabase/migrations`：数据库迁移
- `scripts`：低频运维、回填、验证脚本

## 环境变量重点

最小运行需要：

- `DATABASE_URL`
- `DIRECT_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `MODEL_NAME`
- `EMBEDDINGS_MODEL_NAME`

RAG 相关：

- `ELASTICSEARCH_ENABLED`
- `ELASTICSEARCH_URL`
- `ELASTICSEARCH_INDEX_PREFIX`
- `ELASTICSEARCH_INDEX_VERSION`
- `HYBRID_KEYWORD_BACKEND`
- `NEO4J_GRAPH_ENABLED`
- `NEO4J_URL`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `NEO4J_DATABASE`
- `RAG_SEMANTIC_CACHE_ENABLED`

默认情况下，关键词检索可以走 PostgreSQL。只有 ES 已启动、索引已初始化并完成回填后，再切到 `HYBRID_KEYWORD_BACKEND=elastic`。

## 研发约定

- 默认使用中文沟通和中文文档。
- 先看真实代码和命令结果，再给判断。
- 默认用 `rg` / `rg --files` 搜索。
- 导入路径优先使用 `@/`。
- 不要新增大而全的 service；超过明显可读范围时优先按职责拆分。
- Controller 只处理协议层，业务逻辑放 Service。
- 外部依赖接入用 provider / service 包一层，不在 Controller 里直连。
- 提示词统一放在 `src/common/prompts`，优先使用 LangChain prompt template。
- 新接口需要 DTO 校验和 Swagger 注解。
- RAG 检索失败默认不能阻断基础对话流程，除非当前任务明确要求严格失败。
- PostgreSQL / Supabase 是主数据源；ES 和 Neo4j 是派生索引。
- ES 数据可以重建，Neo4j 图谱可以回填；不要把派生索引当成主数据。
- 改会话协议时，同时检查后端 gateway、session 类型和前端协议处理。

## 做任务时的范围控制

这个项目容易因为 RAG、Docker、ES、Neo4j、LangGraph 混在一起而扩大任务范围。接手时先判断本轮任务类型：

- 只是解释：只沿主链路讲清楚，不顺手改代码。
- 只是验证：只跑必要命令，先给通过或失败的结论。
- 只是清理：只删缓存、镜像或命令入口，不改业务链路。
- 只是修 bug：先复现，再最小修改，再验证。
- 只是优化：先确认是否影响当前主链路，再决定是否动手。

遇到旁支问题时，先记录为后续项。除非它阻塞当前目标，不要直接拉进本轮任务。

## 当前已知注意点

- RAG 主链路已经能接入 `pgvector + Elasticsearch + Neo4j`。
- persona 多知识库检索目前是并行执行，知识库数量很多时可能需要限流。
- Neo4j path 查询在图变大后可能需要优化查询方式。
- RAG 语义缓存恢复校验仍偏轻量。
- `KnowledgeSearchService` 已拆分过一部分职责，但仍承担 persona 知识库查询。
- `@elastic/elasticsearch` 当前是 `8.17.0`，本地 ES 镜像是 `9.3.3`；能连通，但后续最好统一主版本。
- `neo4j-driver` 是 Node 客户端依赖，不是 Neo4j 服务端本体。

## 推荐验证顺序

一般代码改动：

```bash
pnpm test --runInBand
pnpm build
git diff --check
```

RAG 检索改动：

```bash
pnpm rag:preflight
pnpm test --runInBand -- knowledge-content/services/knowledge-search.service.spec.ts knowledge-content/services/knowledge-stage1-retrieval.service.spec.ts
NEO4J_GRAPH_ENABLED=true HYBRID_KEYWORD_BACKEND=elastic pnpm rag:smoke:agentic -- --query=React组件设计讲义
```

ES 改动：

```bash
pnpm es:index:ensure
pnpm es:backfill -- --dry-run
```

Neo4j 改动：

```bash
pnpm neo4j:backfill -- --dry-run
pnpm test --runInBand -- knowledge-content/graph/neo4j-graph-retriever.service.spec.ts
```

文档或脚本入口改动：

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('package.json ok')"
git diff --check
```
