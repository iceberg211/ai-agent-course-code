# RAG Agent

这是一个前后端分离的 RAG Agent 学习项目，核心是文档入库、混合检索、证据评估、答案生成与引用。数字人和语音交互作为可选呈现能力保留。

## 目录结构

| 目录 | 职责 | 技术栈 |
|---|---|---|
| `frontend/` | 管理后台、知识库、对话、数字人与评测界面 | Vue 3、Vite、TypeScript、Pinia |
| `backend/` | HTTP/WebSocket API、RAG、文档入库、权限和异步任务 | NestJS 11、LangGraph、TypeORM |
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
cd backend
pnpm install

cd ../frontend
pnpm install
```

### 2. 配置并启动后端

```bash
cd backend
cp .env.example .env

pnpm rag:infra:up
pnpm db:migrate
pnpm start:dev
```

文档异步处理需要另开一个终端：

```bash
cd backend
pnpm start:worker:dev
```

### 3. 启动前端

```bash
cd frontend
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
cd backend
pnpm typecheck
pnpm test --runInBand
pnpm test:e2e
pnpm build
```

前端：

```bash
cd frontend
pnpm typecheck
pnpm build
```

真实 RAG 依赖检查和 Agent smoke：

```bash
cd backend
pnpm rag:preflight
pnpm rag:smoke:agent-path
```

更详细的子项目说明见：

- [后端说明](docs/backend.md)
- [前端说明](docs/frontend.md)
- [RAG 架构与问题记录](docs/rag-architecture.md)
