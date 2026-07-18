# Digital Human Agent (企业级知识库与数字人问答后端)

本项目是一个成熟化升级的企业级知识库与数字人问答后端系统。技术栈基于 `NestJS 11 + TypeORM + PostgreSQL (Supabase) + WebSocket + LangChain + ElasticSearch + Neo4j`。

本项目作为数字人与知识库的后台服务，重点实现了异步文档提取、多模态融合检索 (RAG)、双记忆体系、细粒度数据权限隔离、知识图谱推理增强以及自动化质量评估。

---

## 🚀 核心功能与技术架构

### 1. 异步任务与多模态文件解析 (Phase 1-2)
- **异步任务队列**：基于 **BullMQ** 和 **Redis** 构建了高可用的 `DocumentTask` 异步解析流水线。支持断点续跑和幂等性处理（重试时自动清理半成品资产数据，避免产生垃圾数据）。
- **对象存储**：集成 S3 (MinIO) 存储，实现了**内外网双端点自适应转换**（后端写入 Docker 内部 endpoint，前端生成预签名 URL 自动替换为外网地址）。
- **多模态文件解析**：
  - **PDF / Office**：支持 PDF、Docx、Pptx、Xlsx 的高保真结构化解析。
  - **图片**：提取 OCR 并调用 Vision-LLM 补充图片场景描述。
  - **音频**：结合 Whisper 进行 ASR 转写及带时间戳的音频分段资产保存。
  - **视频**：结合 FFmpeg 进行画面每 30 秒关键帧截取（限制 maxBuffer 溢出防崩溃），配合 Whisper 提取音视频时间分段信息，并在 markdown 输出中包含视觉场景描述。

### 2. 多路召回融合与 LLM 重排 (Phase 3)
- **多路混合召回**：支持向量检索、ElasticSearch 全文检索、Neo4j 图谱召回以及记忆合流。
- **通用 RRF 融合**：遵循严格的 **RRF (Reciprocal Rank Fusion)** 算法，仅基于各个通道内部的相对排名进行融合计算，避免因各检索器绝对分数差异造成的数据倾斜。
- **智能 LLM 重排**：接入 Reranker。合理区分为“LLM 判定全不相关（打分低于阈值直接返回空，避免垃圾数据回灌）”与“LLM 接口故障（触发回退，保证基础可用性）”的决策边界。

### 3. Redis + mem0 双重记忆体系 (Phase 4)
- **短期会话记忆**：基于 Redis 实现带滑动窗口限制（最大 12 条）的对话上下文及 Summary 滚动更新。
- **长期偏好记忆**：集成 **mem0** 云服务提取并持久化用户长期习惯。
- **防雪崩熔断**：短期和长期记忆模块均配备 **Circuit Breaker (断路器)**。当 Redis 或外部服务抖动时，优雅降级为“空记忆”，保证主问答链路可用。

### 4. 数据范围与 ACL 细粒度过滤 (Phase 5)
- **前置过滤**：利用 PostgreSQL 存储过程在数据库级别前置过滤无权访问的 `allowed_user_ids`、`allowed_department_ids` 和 `allowed_role_ids`。
- **后置安全校准**：在 RAG 数据组装前，调用 `DataScopeService` 进行最终校验核对，防范由于 ES 索引更新延迟或数据库中间件层绕过而引起的安全越权。

### 5. 知识图谱 Neo4j 推理增强 (Phase 6)
- **实体关系提取**：从文档 markdown 中提取实体，并过滤了 markdown 代码块注释符号（`#`）等干扰噪声。
- **一跳图谱推理**：在 LangGraph 中集成了 `graph_reasoning` 节点，允许根据 Top 结果中的关联实体，在 Neo4j 中查询一跳邻居关系，合并回原始文档流，提供更广的上下文面。

### 6. 自动化评测与链路观测 (Phase 7)
- **链路观测**：全面集成了 **Langsmith / Langfuse** 对 RAG 及 Agent 运行步骤、LLM 吞吐量和 Token 消耗进行全链路追踪。
- **批量质量评估**：系统支持自动化执行评测用例，通过以大模型作为裁判，批量生成 **HitRate**（命中率）和 **Recall**（召回率）报告，便于迭代优化检索效果。

### 7. 健壮的 WS 状态机与打断机制 (Phase 8)
- **WebSocket 实时网关**：负责长连接心跳、JWT 验证、滑动窗口防刷限频。
- **高并发打断处理**：在用户打断（`conversation:interrupt`）时，网关**同步**重设 session 属性并向前端发送结束指令（`tts:end` / `digital-human:end`），规避了异步 `finally` 块延时引发的轮次覆盖与状态机紊乱。

---

## 🛠️ 本地开发与部署指南

### 1. 准备基础设施环境
项目依赖 Redis, ElasticSearch, Neo4j, MinIO，可以通过内置的 Docker Compose 快捷拉起：
```bash
# 启动所有本地基础设施环境 (ES、Kibana、Neo4j、Redis、MinIO)
pnpm rag:infra:up

# 关闭基础设施环境
pnpm rag:infra:down
```

### 2. 初始化数据库与配置迁移
数据库底层采用 PostgreSQL (Supabase)，在连接串配置正确后运行结构迁移：
```bash
# 运行数据库表结构迁移（SQL）
pnpm db:migrate
```

### 3. 安装依赖并启动 NestJS 服务
本系统采用分布式架构，主服务进程负责 HTTP 与 WebSocket，工作进程（Worker）负责 BullMQ 异步文件解析：
```bash
# 安装依赖
pnpm install

# 1. 启动 HTTP/WS 主服务（本地热更新监视模式）
pnpm start:dev

# 2. 启动异步文件解析 Worker（本地热更新监视模式）
pnpm start:worker:dev
```

### 4. 冒烟测试与系统验证
```bash
# 运行 RAG 运行前状态预检
pnpm rag:preflight

# 运行 Agent 路径冒烟测试
pnpm rag:smoke:agent-path

# 运行 Agent 决策冒烟测试
pnpm rag:smoke:agentic

# 使用 eval/rag-golden-set.json 运行真实 LangGraph Agent 评测
pnpm rag:eval:agent
# 可覆盖评测文件、角色和执行 profile
# pnpm rag:eval:agent -- --file=eval/rag-golden-set.json --personaId=<uuid> --profileId=realtime_voice

# 执行全量单元测试（包含 mock S3/ES/LLM）
pnpm test --runInBand

# 编译打包构建
pnpm build
```

---

## 🔗 常用服务入口

- **Swagger API 文档**：`http://localhost:3001/api/docs`
- **传统文本 RAG API**：`POST /chat`
- **实时数字人/语音 WS 网关**：`ws://localhost:3001/ws/conversation`
- **知识库管理 API**：`GET/POST /knowledge-bases`
