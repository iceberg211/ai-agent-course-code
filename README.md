# Digital Human Agent

这是一个前后端分离的知识库与数字人问答项目。仓库由 Vue 前端、NestJS 后端和共享架构文档组成。

## 目录结构

| 目录 | 职责 | 技术栈 |
|---|---|---|
| `digital-human-agent-frontend/` | 管理后台、知识库、对话、数字人与评测界面 | Vue 3、Vite、TypeScript、Pinia |
| `digital-human-agent/` | HTTP/WebSocket API、RAG、文档入库、权限和异步任务 | NestJS 11、LangGraph、TypeORM |
| `docs/` | 跨前后端的架构和整理文档 | Markdown |

前后端是两个独立的 pnpm 项目，分别维护依赖和锁文件，不使用根目录 workspace 统一安装。

## 核心链路

```text
前端提问
  → HTTP / WebSocket
  → LangGraph RAG
  → 向量、关键词、图谱召回
  → 重排与证据评估
  → 流式答案与引用
```

文档入库采用独立 Worker：

```text
上传文档
  → DocumentTask
  → BullMQ Worker
  → 解析、切分、Embedding
  → PostgreSQL / Elasticsearch / Neo4j
```

## 本地启动

### 1. 安装依赖

```bash
cd digital-human-agent
pnpm install

cd ../digital-human-agent-frontend
pnpm install
```

### 2. 配置并启动后端

```bash
cd digital-human-agent
cp .env.example .env

pnpm rag:infra:up
pnpm db:migrate
pnpm start:dev
```

文档异步处理需要另开一个终端：

```bash
cd digital-human-agent
pnpm start:worker:dev
```

### 3. 启动前端

```bash
cd digital-human-agent-frontend
pnpm dev
```

## 默认地址

| 服务 | 地址 |
|---|---|
| 前端 | `http://localhost:5173` |
| 后端 | `http://localhost:3001` |
| Swagger | `http://localhost:3001/api/docs` |
| WebSocket | `ws://localhost:3001/ws/conversation` |

## 常用检查

后端：

```bash
cd digital-human-agent
pnpm typecheck
pnpm test --runInBand
pnpm test:e2e
pnpm build
```

前端：

```bash
cd digital-human-agent-frontend
pnpm typecheck
pnpm build
```

真实 RAG 依赖检查和 Agent smoke：

```bash
cd digital-human-agent
pnpm rag:preflight
pnpm rag:smoke:agent-path
```

更详细的子项目说明见：

- [后端 README](digital-human-agent/README.md)
- [前端 README](digital-human-agent-frontend/README.md)
- [RAG 架构与问题记录](docs/rag-architecture.md)
