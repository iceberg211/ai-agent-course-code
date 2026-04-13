# Mini-Manus — AI Agent 课程项目

## 项目概述

任务型 Agent 系统，模仿 Manus 核心交互范式。
技术方案：`docs/简易版-Manus-技术方案总览.md`

---

## 目录结构

```
mini-manus/
├── backend/    NestJS + TypeORM + LangGraph
└── frontend/   React + Vite + Tailwind
```

---

## 技术栈

**后端**：NestJS 11 · TypeORM + **PostgreSQL** · LangGraph.js · LangChain.js · socket.io · EventEmitter2 · Zod

**前端**：React 18 · Vite · Tailwind CSS · socket.io-client · Jotai · TanStack Query

---

## Skills 使用规则

| 场景 | Skill |
|---|---|
| NestJS Module / Service / Controller | `nestjs-best-practices` |
| Node.js 后端通用模式 | `nodejs-backend-patterns` |
| TypeORM Entity / Migration / Repository | `typeorm` |
| LangChain 调用 / 结构化输出 | `deep-agents-core` |
| LangGraph StateGraph / 节点 / 条件边 | `deep-agents-orchestration` |
| Agent 记忆 / 上下文管理 | `deep-agents-memory` |
| React 组件 / Hooks / 数据获取 | `vercel-react-best-practices` |
| UI 可用性 / 可访问性 | `web-design-guidelines` |
| OpenAI SDK / structured output | `openai-docs` |

---

## 架构约束

### 模块边界
- **Agent Runtime 不直接写数据库**，通过回调交给 TaskService 持久化
- **Agent Runtime 不直接推 WebSocket**，通过 EventEmitter2 → Gateway 推送
- **Controller 只做参数校验 + 调 Service**，不写业务逻辑
- **跨 Module 依赖走 NestJS DI**，不直接 import 其他 Module 的 Service

### 数据模型（已冻结）
```
task → task_revision → task_run → task_plan → plan_step
                                ↘ step_run (FK → plan_step)
                                ↘ artifact
```
- task 字段：id, title, status, current_revision_id, current_run_id
- task_run 字段：status, cancel_requested, run_number, error_message
- step_run 字段：executor_type(tool|skill), skill_trace(JSONB)
- plan_step 字段：skill_name?, skill_input(JSONB)?, tool_hint?
- JSON 字段统一用 **JSONB**（PostgreSQL）

### PostgreSQL 数据库约束
- `task_revision(task_id, version)` UNIQUE
- `task_run(revision_id, run_number)` UNIQUE
- `task_plan(run_id, version)` UNIQUE
- `plan_step(plan_id, step_index)` UNIQUE
- `step_run(run_id, execution_order)` UNIQUE
- 并发控制："读取 task 状态 → 创建 run → 更新 current_run_id" 必须在一个事务里

### 状态机
- `task.status` 只由 `current_run_id` 对应的 run 更新
- run 终态路径（completed / failed / cancelled）都调 `finalize_run(taskId)`
- 每个 evaluator 分支都必须把 step_run 更新到终态再发事件
- retry：先把当前 step_run 标 failed，再创建新 step_run（引用同一 plan_step）

### 工具层
- 所有 Tool 输入经过 Zod schema 校验
- Tool 输出截断至 5000 字符
- `browse_url` 屏蔽私网 IP / localhost / metadata 地址（SSRF 防护）
- 文件操作路径必须通过 `WorkspaceService.resolveSafePath()` 校验

### Skill 层
- V1 只支持内置 Skill，SkillModule 启动时注册，不支持运行时加载外部文件
- Skill 接口声明 `effect: 'read-only' | 'side-effect'`
- side-effect Skill 的 execute() 必须幂等（覆盖写，非追加写）
- SkillContext 注入 `signal: AbortSignal`（支持取消）

### LangGraph
- StateGraph state 字段有 TypeScript 类型（Annotation.Root），不用 any
- 节点是纯函数（state in → partial state out），不在节点内操作 DB / WebSocket
- 条件边的判断逻辑基于 state 字段

---

## 执行约束

| 约束 | 值 |
|---|---|
| 单步最大重试次数 | 3 |
| 单 run 最大重规划次数 | 2 |
| 单 run 最大步骤总数 | 20 |
| 单步超时 | 60s |
| Tool 输出最大长度 | 5000 字符 |

---

## TypeORM 规则

- **禁止 `synchronize: true`**（开发和生产都禁止）
- Schema 变更通过 migration：`npm run migration:generate -- src/migrations/MigrationName`
- Entity 在模块的 `entities/` 子目录
- Migration 在 `backend/src/migrations/`

---

## 启动时必做

`onModuleInit` 扫描所有 `running` 状态的 run，标记为 `failed`（"系统意外中止"）——防止僵尸 Run 阻塞新执行。

---

## V1 不做

- 浏览器自动化（Playwright）
- 代码执行沙箱
- 多 Agent 协作
- 运行时从外部文件加载 Skill
- Vercel AI SDK
- 多租户 / 权限系统
- 语音输入输出
