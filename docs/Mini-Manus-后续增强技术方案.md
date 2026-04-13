# Mini-Manus 后续增强技术方案

## 1. 文档目标

本文档用于承接 `Mini-Manus` 当前版本之后的下一阶段建设，重点覆盖以下能力：

1. 构建、测试、依赖和配置收口
2. 轻量认证、限流、API 配额保护
3. Token / 成本观测
4. Planner 语义校验
5. Workspace 生命周期清理
6. 事件持久化回放
7. 浏览器自动化（向下演进真实 Computer Use）
8. 代码执行沙箱
9. 跨 Run 记忆（优先级：低）
10. 多 Agent 编排

本方案默认遵循以下原则：

- 短期继续保持单 Agent 主线，先把主链路稳定下来
- 不推翻现有 `task -> revision -> run -> plan -> step_run -> artifact` 数据模型
- 继续使用 `socket.io` 作为主实时通道
- 优先做“明显提升任务完整交付能力”的能力，而不是盲目扩大范围
- 浏览器、沙箱、多 Agent 都通过模块和工具接口接入，不直接写进现有节点内部
- 多 Agent 先做成“Agent 作为 Skill”，再逐步升级为独立编排层
- 当前阶段先补关键路径测试，不先建设正式评测框架

## 2. 当前现状评估

> **文档更新说明**（2026-04-14）：引入能力成熟度 5 级标签，替代二元"已完成/待实现"；吸收外部 review 反馈，修正 Tool Calling、代码生成、事件回放、model_name 等项的状态标注；补充沙箱安全 checklist 和认证边界声明。
>
> **能力成熟度标签定义**：
> | 标签 | 含义 |
> |------|------|
> | `未做` | 无代码实现 |
> | `原型可用` | 有代码但未经测试或只跑通 happy path |
> | `演示稳定` | 可在课程/演示中使用，边界 case 可能失败 |
> | `工程可维护` | 有测试、日志、错误处理，可持续迭代 |
> | `生产级` | 安全、可观测、可扩展，适合公开部署 |

### 2.1 已经具备的能力

当前系统已经具备以下能力：

**核心执行链**
- 任务中心：创建、编辑、重试、取消、历史 Run 回看
- Agent 执行链路：**router → planner → executor → evaluator → finalizer**
- Intent Router：轻量 LLM 分类，路由到领域特化规划策略（code_generation / research_report / competitive_analysis / content_writing / general）
- Executor Tool Calling：Tool 路径不再机械透传 Planner 参数，改用 `llm.bindTools()` 根据前序步骤真实输出动态决议参数
- StepResult 携带真实工具输出（`toolOutput` 字段），后续步骤 Tool Calling 可读取实际数据（URL、页面内容等）
- 实时反馈：步骤开始、progress、tool 调用、tool 完成、artifact 创建、**plan.generating 事件**
- 多产物：`markdown / json / code / diagram / file`

**工具与 Skill**
- 工具层：网页搜索、网页抓取（静态）、Markdown 抽取、文件读写、目录读取、文件下载、PDF 文本提取、GitHub 搜索、PDF 导出（Playwright 原生中文支持）
- Skill 层：调研、文档写作、竞品对比、briefing、产物审阅、报告打包、**代码项目生成（单 Artifact 模式）**
- 工具有 `read-only / side-effect` 分类，read-only 工具支持简单缓存
- report_packaging Skill 拆为两步：纯文本生成 Markdown + structured output 提取元数据，避免长文本 JSON 编码崩溃

**稳定性与安全**
- Evaluator 结构性错误分类：JSON 解析、编码、权限等不可恢复错误跳过重试直接 replan/fail
- Evaluator retry 时保留 `lastStepOutput`，Tool Calling 重试可看到前次失败原因并选择不同参数
- Tool Calling 参数经 Zod schema 校验（注入 task_id 后再校验），fallback 参数含占位符时主动报错
- Tool Calling 30s 独立超时 + AbortSignal 取消控制
- 分级超时：Tool 路径用 `STEP_TIMEOUT_MS`，Skill 路径用 `SKILL_TIMEOUT_MS`（默认 5 分钟）
- retry/replan 超限可标记 FAILED
- `startRun`、`finalizeRun` 使用 task 行悲观锁降低并发错乱风险
- `createTask` 事务提交后再发事件和启动执行
- cancel 分支会补 `step.failed` 事件
- deleteTask 使用事务删除数据库记录，并在事务提交后清理 workspace
- 提示词安全：用户输入注入检测（detectInjection）+ 6 个 prompt 安全声明
- Planner 语义校验：`skillName/toolHint` 注册校验 + `safeParse` 输入校验 + `stepIndex` 顺序校验 + 最大步骤数 + side-effect 白名单策略 + 带错误反馈最多两次重试
- 速率限制：`@nestjs/throttler`，全局 60次/分，任务创建 10次/分
- WebSocket 认证：`WS_AUTH_TOKEN` 环境变量开启 token 鉴权
- HTTP API Key：写接口通过 `x-api-key` 保护，开发环境未配置时免鉴权，生产环境强制配置 `APP_API_KEYS`
- 配置校验：Zod schema 校验必填项，启动时失败快速抛出

**可观测性**
- Token 统计：Run 级聚合（输入/输出/总计）+ 实时推送前端 RunDebugPanel
- Token 持久化：`task_runs` 新增 `input_tokens / output_tokens / total_tokens / estimated_cost_usd` 列
- 成本估算：内置模型价格表（gpt-4o / gpt-4o-mini / qwen-plus / deepseek 等）
- 前端 Run Debug：优先展示实时 token 数据，刷新后回退读取持久化 token 和成本字段
- 事件持久化：`EventPublisher` 写入 `task_events`，并提供 `GET /api/tasks/:id/events`
- 健康检查：`GET /api/health` 含 DB 连通性探测
- 请求日志：`LoggingInterceptor` 记录每个 HTTP 请求耗时

**资源治理**
- Workspace 清理：deleteTask 事务提交后自动清理任务目录
- Workspace 定期清理：`WorkspaceCleanupService` 可按 `WORKSPACE_CLEANUP_ENABLED` 启用，扫描缺失 task 或超期终态 task 的目录
- Task 级跨 Run 记忆（第一层）：Planner 从最近 3 次 completed run 的 JSON 摘要中读取历史上下文
- 优雅关闭：`enableShutdownHooks` + `OnModuleDestroy` 中止所有 in-flight run

**配置**
- 配置化运行参数：`MAX_RETRIES / MAX_REPLANS / MAX_STEPS / STEP_TIMEOUT_MS / TOOL_CACHE_TTL_MS / LLM_CACHE_ENABLED / EXPORT_PDF_ENABLED`

**工程健康**
- 后端 `pnpm build` 通过
- 前端 `pnpm build` 通过
- 后端 `pnpm test` 已覆盖 TaskService 主链路、Planner 语义校验、Agent 配置、token 统计、API Key、事件发布和 Workspace 清理
- 后端 `pnpm test:e2e` 已覆盖 `/api/tasks` 列表、创建、DTO 校验和事件日志接口
- 后端 `ChatOpenAI.modelName` 类型问题已通过 `AgentService.modelName` 收口
- 后端 `PlanSchema._type` 类型问题已改为 `z.infer<typeof PlanSchema>['steps']`
- 前端 `mermaid` 依赖已可参与构建

### 2.2 部分完成但需要收口的能力

以下能力已经有代码基础，但还不能按“稳定完成”看待：

| 能力 | 当前状态 | 需要补齐 |
| --- | --- | --- |
| Token / 成本观测 | Run 级统计、持久化、实时事件、`model_name` 追溯、前端刷新后展示已完成 | 还缺节点级明细、价格配置覆盖和 budget exceeded 特殊提示 |
| Planner 语义校验 | 已校验执行器存在、input schema、`stepIndex` 顺序/重复/跳号、最大步骤数、side-effect 白名单 | 后续需要接入人工审批和更细的工具预算 |
| 配置管理 | `ConfigModule` + Zod schema 已接入，`.env.example` 已补 CORS / WebSocket / API Key / Planner / Workspace / LLM / 导出相关项 | 后续可抽独立配置 schema 模块 |
| WebSocket 认证 | 配 token 时可鉴权 | 前端需统一配置 `VITE_WS_AUTH_TOKEN`，生产环境部署要有密钥注入说明 |
| HTTP API Key | 写接口 Guard 已接入 | 后续可升级为 api_clients + 配额表 |
| 事件持久化 | `task_events` 表、发布链路、任务事件接口、前端 `replayEvents` 第一版已接入 | 还缺游标增量拉取、断线补漏、保留策略和回放测试 |
| Workspace 清理 | 删除任务时会清理目录，可选定期扫描已接入 | 默认关闭，生产部署需显式开启和设置保留天数 |
| Task 级记忆 | Planner 可读取最近 completed run 的 JSON 摘要 | 只按 task 读取，没有 artifact/source 级记忆，也没有相似任务匹配 |
| 浏览器只读能力 | `browser_open / browser_extract / browser_screenshot` 已接入，默认关闭 | 尚未开放点击、输入、等待元素和登录态 |
| 工程健康 | 构建已恢复，后端初始业务测试已补 | 前端仍无自动化测试，前端 Mermaid 相关 chunk 偏大 |

### 2.3 当前主要缺口

以下能力尚未实现，按优先级排列：

#### 工程健康缺口

- 后端已有初始业务测试，但还没有覆盖真实数据库集成、Agent 图执行失败恢复和并发 run 场景
- e2e 已对齐 `/api/tasks` 冒烟场景，但还没有覆盖 `GET /api/health` 和异常过滤器输出格式
- 前端没有自动化测试
- 前端生产构建通过，但 Mermaid 相关 chunk 较大，需要后续做产物渲染的按需加载和 chunk 策略

#### 执行能力缺口

- 浏览器只读能力已接入，但还没有交互工具和受控登录态
- 无代码执行沙箱，代码生成后无法运行验证
- Skill 内部工具调用仍以串行为主，缺少并行执行
- 无多 Agent 编排层，所有任务仍由单一执行图推进

#### 可观测性缺口

- 事件已经写入 `task_events`，前端已能用历史事件恢复 live feed 第一版；仍缺游标增量拉取、断线补漏和回放测试
- 节点级 LLM 调用明细（planner/evaluator/finalizer/skill 各用了多少 token）尚无独立表记录
- 工具调用只有 live 事件和 stepRun 字段，没有独立审计表

#### 记忆与生命周期缺口（低优先级）

- Workspace 定期清理已接入，但默认关闭，部署时需要显式配置
- Artifact 级记忆复用（第二层）和来源级记忆（第三层）尚未实现（由于 ROI 偏低，当前阶段作为最低优先级）
- 输出截断仍偏粗暴，长内容没有先摘要再截断

#### 认证与配额缺口

- HTTP 写接口已有 API Key Guard，但还没有每日配额表
- 无每日配额表（`api_clients` / `api_usage_daily`）
- 浏览器会话已有第一版进程内管理，代码执行沙箱还没有

### 2.4 阶段判断

当前项目处在：

**单 Agent 核心系统已成型，构建健康、后端初始测试和第二阶段可维护能力已恢复；第 3 阶段的浏览器只读工具已接入。**

因此下一阶段仍不要直接从多 Agent 开始。当前浏览器边界保持为：只打开页面、抽取 DOM 文本、截图，不做登录态、点击和输入。后续优先补浏览器部署验证、前端事件回放和沙箱第一版。

## 2.5 Agent 编排成熟度评估：业界对比与差距分析

> 更新日期：2026-04-14。基于业界架构实证调研（Claude Code / Codex / Manus / Devin）和本轮改进后的评估。

### 2.5.0 业界主流 Agent 架构实证

基于官方文档、源码分析和技术深度解析，业界 Agent 分为三种架构模式：

| 系统 | 架构模式 | 有独立 Planner？ | 参数决议方式 | 计划粒度 |
|------|---------|----------------|------------|---------|
| **Claude Code** | ReAct while-loop（~88 行 Rust） | ❌ 无。TodoWrite 是工具不是架构 | 逐步，基于完整消息历史 | 无固定计划 |
| **OpenAI Codex** | ReAct while-loop（Rust，几乎同架构） | ❌ 无 | 逐步 | 无固定计划 |
| **Manus** | Plan-then-Execute + CodeAct | ✅ 有 Planner Agent | 逐步（CodeAct = 可执行 Python） | **高层任务**（todo.md） |
| **Devin** | Multi-agent compound | ✅ 有 Planner Model → Coder → Critic | Planner→Coder→Critic 流水线 | 高层策略 |
| **mini-manus（当前）** | Plan-then-Execute + Tool Calling 补丁 | ✅ 有 | Planner 预绑定 + TC 修正 | **工具调用级**（含参数） |

**核心发现**：

1. **Claude Code / Codex 没有 Planner 组件**，是纯 ReAct。适合交互式编码，但不适合任务型产品（无法展示计划/进度/审批）。
2. **Manus / Devin 有 Planner**，但计划粒度是"高层任务描述"（如"调研 React 方案"），不是"工具调用 + 参数"（如 `fetch_url({ url: "xxx" })`）。动态参数在 step 内部运行时决议。
3. **mini-manus 的问题**不是"有 Planner"本身，而是 Planner 绑定到了工具调用粒度，把动态参数提前固定了。

**目标架构方向（Manus 模式）**：

```
外层：高层能力步骤计划（Planner 或确定性 workflow）
  → 步骤粒度：skill / workflow / objective，不绑定动态参数
内层：每个 Step 内部 ReAct 式工具调用（Skill 已具备）
  → 参数基于前序真实结果，逐步决议
边界：代码控制（schema / guardrail / 权限 / 超时 / 审批）
```

Planner 的输出应该从：

```json
❌ { "toolHint": "fetch_url", "toolInput": { "url": "https://猜的.com" } }
```

升级为：

```json
✅ { "skillName": "web_research", "objective": "调研 React Compiler 最新进展" }
```

让 Skill 内部自己做 search → pick URLs → fetch → summarize，Planner 不负责猜 URL。

### 2.5.1 编排层对比

| 能力 | 业界成熟做法 | 当前实现 | 差距 | 改进方向 |
|------|-----------|---------|------|---------|
| **意图路由** | 意图分类 → 领域特化 workflow（Manus、Coze） | ✅ Intent Router 已实现，5 种意图分类 + 领域规划指引 | **小** | 后续可扩展意图类型，加规则引擎 |
| **计划生成** | 高层能力步骤 + 确定性 workflow（Manus：todo.md / Devin：plan→code→test→fix） | Planner 仍生成工具调用级计划（含参数），intent 只注入 prompt 指引 | **中** | ① 高频任务走确定性 workflow ② Planner 输出升级为"能力步骤"（skill + objective），不绑定动态参数 |
| **参数决议** | ReAct 实时观察（AutoGPT）/ Tool Calling（OpenAI Assistants） | ⚠️ Tool Calling + bindTools 已接入，动态参数工具已有 fail-closed 原型；静态参数工具仍允许受控 fallback | **中→小** | 补 fail-closed 单元测试、结构化 `errorCode`，再做选择性 Tool Calling 降成本 |
| **错误恢复** | retry + replan + 人工介入 + 结构性错误分类 | ✅ 结构性/瞬态错误分类 + retry 带上下文 + HITL | **小** | 已接近业界水平 |
| **多 Agent** | Supervisor + 专业化子 Agent（CrewAI、LangGraph） | 未实现，规划为 M1-M3 阶段 | 大 | 先做 Agent as Skill（M1） |

### 2.5.2 工具层对比

| 能力 | 业界成熟做法 | 当前实现 | 差距 | 改进方向 |
|------|-----------|---------|------|---------|
| **代码生成** | 模板 + 沙箱验证（bolt.new：模板脚手架 + 定制）/ 单 Artifact（Claude Artifacts） | ⚠️ 单 Artifact 模式 V1 可演示，缺沙箱验证和 fix loop | **中→大** | 需 sandbox_run_node 验证 + generate→run→fix→package 闭环 |
| **代码执行** | sandboxed runtime + 编译验证（Devin、Code Interpreter） | ❌ 未实现 | **大** | S1 阶段引入 Docker 沙箱 |
| **文件操作** | 批量 + 原子操作 | ✅ 代码项目走 Skill 内批量写入 | **小** | — |
| **网页抓取** | headless browser + 静态 fallback + 重定向跟随 | Playwright + axios，但重定向处理待改进 | 小 | fetch_url_as_markdown 需处理 JS 重定向页 |
| **PDF 生成** | Playwright HTML 渲染 / WeasyPrint | ✅ Playwright 渲染，原生 CJK 支持 | **小** | — |

### 2.5.3 产物层对比

| 能力 | 业界成熟做法 | 当前实现 | 差距 |
|------|-----------|---------|------|
| 产物类型 | markdown / code / diagram / 交互式预览 | markdown / code / diagram / PDF / JSON | **小** |
| 产物预览 | 实时渲染 + 可编辑（Canvas / Artifacts） | 静态展示 | 中 |
| 产物迭代 | 增量编辑（"修改第二段"） | 重新生成整个产物 | 中 |
| Observation 链路 | 工具输出直接进入下步上下文 | ✅ StepResult.toolOutput 已实现 | **小** |

### 2.5.4 已解决的关键工程问题

本轮（2026-04-13）解决的问题和业界参考：

| 问题 | 业界叫法 | 本轮方案 |
|------|---------|---------|
| Planner 参数在运行时才能确定 | Late Binding / Dynamic Parameter Resolution | Executor Tool Calling（`llm.bindTools`）|
| 长文本塞 JSON 编码崩溃 | Structured Output Fragility | Skill 层拆分：正文纯文本 + 元数据 structured output |
| 代码项目拆成 N 个 write_file step | Artifact Granularity Problem | 单 Artifact 模式（`---FILE: path` 分隔，1 次 LLM） |
| 所有任务走同一个 Planner | One-size-fits-all Planning | Intent Router → 领域特化规划策略 |
| 错误重试死循环 | Retry Storm / Infinite Retry | 结构性错误分类 + retry 带失败上下文 |
| PDF 中文乱码 | CJK Font Encoding | pdf-lib → Playwright HTML 渲染 |
| Skill 超时太短 | Timeout Granularity | 分级超时：`STEP_TIMEOUT_MS` / `SKILL_TIMEOUT_MS` |

### 2.5.5 剩余核心差距（按优先级排序）

1. **Planner 粒度升级**（差距：中，架构关键）—— 当前 Planner 输出"工具调用 + 参数"，应升级为"能力步骤 + objective"（Manus 模式）。这是解决"静态计划绑定动态参数"问题的根本方案，比 Tool Calling 补丁更彻底。
2. **高频任务确定性 workflow**（差距：中）—— Intent Router 只注入 prompt 指引。高频任务应代码直接返回固定计划（如 `code_generation: [web_research, code_project_generation]`），不经过 LLM Planner。
3. **代码执行沙箱**（差距：大）—— 生成代码但不能验证，是当前最大能力缺口。对应文档 §8。
4. **Tool Calling fail-closed**（差距：中）—— 动态参数工具（fetch_url / write_file / export_pdf）TC 失败时应直接报错，不 fallback 到 Planner 幻觉参数。
5. **产物增量编辑**（差距：中）—— 当前只能整体重新生成，不支持"修改第三段"。需要 artifact diff + patch 机制。
6. **多 Agent**（差距：大）—— 对应文档 §11，按 M1→M2→M3 推进。

### 2.5.6 阶段判断更新

当前项目处在：

**单 Agent 核心系统已成型，编排链路从 Plan-then-Execute 演进到 Intent Router + Tool Calling 混合模式，多数能力达到"演示稳定"。下一步架构目标是向 Manus 模式演进：Planner 只输出高层能力步骤（skill + objective），动态参数由 Skill 内部 ReAct 式决议。同时补齐确定性 workflow、代码执行沙箱和 fail-closed 参数校验。**

## 3. 轻量认证、限流与 API 配额保护

### 3.1 目标

> ⚠️ **认证边界声明**：当前 `x-api-key` 方案适用于个人/课程演示。在 SPA 前端中，API Key 会暴露在浏览器 bundle、DevTools 和网络请求中，**不等同于生产级用户认证**。如需公开部署，应升级为 session/JWT/OAuth，由后端基于用户身份做 run/token 配额。教学阶段可叠加反向代理 Basic Auth 或部署平台访问密码。

这部分对个人项目不是最高优先级，但至少应做到：

- 不让任何人直接匿名调用接口
- 防止短时间高频调用打爆模型额度
- 对调用方有最基础的额度约束

### 3.2 推荐方案

#### 第一层：轻量认证

推荐使用最简单、最稳妥的方式：

1. 后端新增 `x-api-key` 认证头
2. 环境变量维护允许列表，例如：
   - `APP_API_KEYS=dev-key-1,dev-key-2`
3. NestJS 增加全局 `ApiKeyGuard`
4. 只对白名单 key 放行写操作接口：
   - `POST /tasks`
   - `POST /tasks/:id/retry`
   - `POST /tasks/:id/cancel`
   - `PUT /tasks/:id/edit`
   - `DELETE /tasks/:id`

如果前端也要一起保护，可以再叠加一层：

- 反向代理 Basic Auth
- 或部署平台自带密码保护

#### 第二层：限流

推荐直接接入 `@nestjs/throttler`：

- 读接口：`60 req / min / IP`
- 写接口：`20 req / min / IP`
- 可按路由分组限流

如果后续已经引入 API Key，可把维度从 IP 升级成：

- `IP + API Key`

#### 第三层：简单配额

个人项目不建议一开始做复杂计费系统，推荐做“每日配额”即可。

新增两张轻量表：

1. `api_clients`
   - `id`
   - `name`
   - `api_key_hash`
   - `status`
   - `daily_run_limit`
   - `daily_token_limit`

2. `api_usage_daily`
   - `client_id`
   - `date`
   - `run_count`
   - `input_tokens`
   - `output_tokens`
   - `total_tokens`

写接口在进入任务创建前先校验：

- 今日 Run 数是否超限
- 今日 token 是否超限

### 3.3 优先级建议

这部分不是当前第一优先级，建议按下面顺序做：

1. `x-api-key`
2. `@nestjs/throttler`
3. 每日配额表

## 4. Token / 成本观测

### 4.1 当前实现状态

Token 统计已经做到 Run 级可用，前端展示也已完成基础收口。

当前已经实现的链路：

1. 后端在单个 Run 内聚合所有 LLM 调用的 token 用量
2. 支持兼容多种 usage 字段路径
3. Run 结束后通过 `run.token_usage` 事件推送给前端
4. 后端会把 token 和估算成本写回 `task_runs`
5. 前端 `Run Debug` 面板可以在 live 期间显示：
   - `Input Tokens`
   - `Output Tokens`
   - `Total Tokens`
   - `Estimated Cost`
6. 刷新页面后，`Run Debug` 会从 `RunDetail` 的持久化字段读取 token 和成本

当前已经具备：

- `Run 级别 token 聚合`
- `Run 级别 token 持久化`
- `live 期间实时展示`
- `刷新后持久展示`
- `估算成本展示`

### 4.2 当前缺口

> **状态更新**（2026-04-14）：`task_runs.model_name` 字段和 migration 已完成，`AgentService.saveTokenUsage` 已写入 modelName。

当前实现还差以下关键点：

1. ~~`task_runs` 没有 `model_name` 字段~~ → **已完成**
2. 没有分节点统计（planner / evaluator / finalizer / skill 各消耗多少 token）
3. 价格表在代码常量中，暂时没有配置覆盖能力
4. 前端 budget exceeded 时缺少特殊提示（只显示通用错误）

### 4.3 推荐架构

#### 第一阶段：补前端持久展示

已完成。实现方式是不改表结构，直接利用已经存在的字段：

- `input_tokens`
- `output_tokens`
- `total_tokens`
- `estimated_cost_usd`

已完成的改动：

1. `RunSummary / RunDetail` 类型增加 token 和成本字段
2. `RunDebugPanel` 优先读 `liveRunFeed.tokenUsage`，没有 live 数据时读 `runDetail`
3. `run.token_usage` payload 增加 `estimatedCostUsd`，前端显示 `Estimated Cost`

#### 第二阶段：确认 model_name 追溯（已完成）

`task_runs.model_name` 字段、migration 和 `AgentService.saveTokenUsage` 写入链路均已完成。

这意味着历史 Run 的成本估算已经可以追溯到具体模型。后续不再把 `model_name` 作为待办，Token 观测的重点转为节点级明细、价格配置覆盖和预算耗尽的产品提示。

#### 第三阶段：补节点级明细

新增一张 `llm_call_logs` 表：

- `id`
- `run_id`
- `step_run_id`
- `node_name`
- `model_name`
- `input_tokens`
- `output_tokens`
- `total_tokens`
- `estimated_cost_usd`
- `duration_ms`
- `created_at`

其中 `node_name` 取值建议固定为：

- `planner`
- `evaluator`
- `finalizer`
- `skill:<skill_name>`

**节点级拆分的技术路径**：

当前 `TokenTrackerCallback` 是在 `compiled.invoke()` 时全局挂载的，只能拿到聚合数据，无法区分调用来自哪个节点。

推荐方案：每个节点函数（planner/evaluator/finalizer/skill）内部各自创建独立的 `TokenTrackerCallback` 实例，节点结束后通过 `eventPublisher.emit(TASK_EVENTS.LLM_CALL_COMPLETED, { nodeName, ... })` 发射一条明细事件，`EventLogService` 负责将其写入 `llm_call_logs`。全局的 `TokenTrackerCallback` 继续保留用于 Run 级聚合，两者互不干扰。

#### 第四阶段：价格配置

不要把复杂价格表直接塞进 `.env`，推荐两种方式：

1. 代码内维护一份默认价格映射
2. 可通过配置覆盖个别模型单价

推荐结构：

```ts
interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}
```

成本公式：

```text
input_cost = input_tokens / 1_000_000 * inputPerMillionUsd
output_cost = output_tokens / 1_000_000 * outputPerMillionUsd
estimated_cost_usd = input_cost + output_cost
```

### 4.4 推荐落地顺序

1. 前端读取并展示持久化 token 字段（已完成）
2. 前端展示 `estimatedCostUsd`（已完成）
3. `task_runs.model_name` 追溯（已完成）
4. 最后再做节点级明细、价格表配置覆盖和预算耗尽特殊提示

## 5. Planner 语义校验

### 5.1 当前状态

当前 Planner 已经有结构校验和主要语义校验：

- `steps` 数组
- `stepIndex`
- `description`
- `skillName / skillInput`
- `toolHint / toolInput`
- `skillName` 是否注册
- `toolHint` 是否注册
- `skillInput / toolInput` 是否通过 schema
- `stepIndex` 是否按数组顺序从 0 连续递增，是否存在重复或跳号
- 计划步骤数是否超过 `PLANNER_MAX_STEPS`
- side-effect 工具是否在 `PLANNER_ALLOWED_SIDE_EFFECT_TOOLS` 中启用
- side-effect Skill 是否在 `PLANNER_ALLOWED_SIDE_EFFECT_SKILLS` 中启用
- 语义校验失败时，最多带错误反馈重试一次

这部分方向正确，基础规则和第一版副作用策略已覆盖。

### 5.2 当前风险

当前仍可能出现：

1. side-effect 只有白名单，没有人工审批
2. 高风险工具还没有单独预算，例如最大调用次数、最大输出长度、最大下载体积
3. schema 错误信息对 Planner 仍偏底层，复杂对象修正效果不稳定
4. 未来浏览器、沙箱接入后，需要独立开关，不应复用当前文件类 side-effect 白名单

### 5.3 推荐架构

现有位置是正确的：

```text
planner llm output
    -> GuardrailChain 安全防护（已实现）
    -> PlanSchema 结构校验
    -> PlanSemanticValidator 语义校验
    -> savePlan
```

**已实现的 Guardrail 机制**：

当前 `planner.node.ts` 中已通过 `buildGuardedPlannerChain()` 在 LLM 输出和语义校验之间包裹了一层 Guardrail Chain。若 Guardrail 检测到输出违反安全策略，会抛出 `GuardrailBlockedError`，Planner 节点会立即终止本 Run 并标记 `errorMessage: guardrail_blocked:<reason>`。该机制在两次校验尝试中均生效。

### 5.4 语义校验规则

`PlanSemanticValidator` 已经覆盖基础规则和第一版副作用规则：

#### 基础规则

- `stepIndex` 必须从 0 开始连续递增
- `description` 不能为空
- 每个 step 必须有且只能有一个执行器：
  - `skillName`
  - 或 `toolHint`

#### Registry 校验

- `skillName` 必须存在于 `SkillRegistry`
- `toolHint` 必须存在于 `ToolRegistry`

#### Schema 校验

- `skillInput` 通过 `skill.inputSchema.parse()`
- `toolInput` 通过 `tool.schema.parse()`

#### 副作用约束

- 对 `side-effect` skill/tool 加一层白名单策略
- 默认 Planner 优先选择 read-only 能力
- 对高风险工具继续增加显式开关，例如：
  - `BROWSER_AUTOMATION_ENABLED`
  - `ENABLE_CODE_SANDBOX`

### 5.5 错误处理策略

语义校验失败时，不建议直接让 executor 报错。

推荐策略：

1. 收集语义错误列表
2. 反馈给 Planner 重新生成一次计划
3. 若连续两次语义校验失败，则终止本轮 Run

## 6. Workspace 生命周期清理

### 6.1 当前状态

当前系统已经有：

- `getTaskDir(taskId)`
- `ensureTaskDir(taskId)`
- `cleanTaskDir(taskId)`
- `listTaskWorkspaceDirs()`
- `deleteTask(taskId)` 事务提交后调用 `cleanTaskDir(taskId)`
- `WorkspaceCleanupService` 可选定时扫描并清理：
  - 数据库已不存在的 task 目录
  - 已完成、已失败、已取消且超过保留期的 task 目录

也就是说，“删除任务时清理目录”和“定期清理残留目录”都已纳入任务生命周期。

当前还缺两件事：

1. 生产部署中显式开启清理任务
2. 如果未来 artifact 文件改为文件存储，需要区分 workspace 临时文件和长期交付文件

### 6.2 当前风险

如果长期运行，`/tmp/mini-manus-workspaces` 会持续累积：

- 下载的文件
- 中间产物
- 导出的 PDF
- 调试残留文件

### 6.3 推荐策略

#### 场景一：删除任务时立即清理

当前已经实现，后续只需要守住这个顺序：

```ts
await workspace.cleanTaskDir(taskId)
```

注意顺序：

1. 先取消 Run
2. 先删除数据库记录
3. 事务提交成功后再删目录

不要把文件删除放在数据库事务内部。

#### 场景二：定期清理过期工作区

已新增一个可配置定时清理任务，默认关闭。

- `WorkspaceCleanupService`
- 配置项：`WORKSPACE_RETENTION_DAYS`
- 配置项：`WORKSPACE_CLEANUP_ENABLED`
- 配置项：`WORKSPACE_CLEANUP_INTERVAL_MS`

规则建议：

- 已删除 task：直接清理
- 已完成 / 已失败 / 已取消 task：
  - 若最后更新时间超过 7 天，则清理

需要新增一个轻量扫描器：

- 遍历 workspace 下目录
- 找到数据库中已不存在的 taskId
- 找到超期 task 的目录
- 执行删除

#### 场景三：导出型文件长期保留策略

如果未来 artifact 文件改为真实文件存储，可增加：

- `retainWorkspaceFiles = false`
- `artifact storage mode = db | file | object-storage`

本阶段先不用做复杂存储分层。

## 7. 浏览器自动化

### 7.1 目标

解决静态抓取拿不到动态页面的问题，让 Agent 可以：

- 打开页面
- 等待 JS 渲染完成
- 抓取 DOM 文本
- 截图
- 提取局部内容

第一版已限制为只读能力，不开放点击、输入、登录态复用和人工接管。

### 7.2 推荐技术选型

推荐直接使用 `Playwright`。

原因：

- Node.js 生态成熟
- 支持 Chromium / Firefox / WebKit
- 适合网页自动化与截图
- 后续如果要做登录态、复杂页面操作，也更容易扩展

### 7.3 推荐接入方式与技术演进路线（核心变轨）

当前的浏览器方案仅局限于无头进程中的传统网页抓取。这在下一步面对复杂交互和动态站点时面临严重的局限。
接下来，我们将采取**两条相互结合的路线**推进：

#### 路线 A：基于 CDP 的传统结构化交互（DOM驱动）
这部分作为现有 `BrowserModule` 的延伸：
使用 Playwright 通过 Chrome DevTools Protocol (CDP) 连容器里的 Chromium。
Agent 的动作通过传统 DOM 指令驱动，例如 `browser_click({ selector: '#submit' })`。
- **优点**：成熟，对于标准网页抓取速度快且精准。
- **缺点**：不兼容 Canvas 控制、验证码、强安全防控站点、复杂弹窗图层。

#### 路线 B：基于 Docker Xvfb 的视觉坐标沙箱（Computer Use 驱动）🌟
这是后续使 Agent 从“爬虫”走向“OS级代操作AI”的终极形态：
1. **基础架构**：用代码拉起提供真实图形界面的 Docker 容器（容器内置 Xvfb 虚拟屏幕 + Chromium）。
2. **转播与人工接管**：通过 `x11vnc` 结合 `websockify`，提供一条标准的 VNC 级 WebSocket 流给前端展示（类似 "AI 正在浏览" 浮窗）。人工可以随时在前端界面点击鼠标接管。
3. **坐标交互原语**：提供全新大工具包 `computer_action`，告别 `selector`，让大模型只看截图输出屏幕物理坐标（`{"action": "click", "x": 100, "y": 200}`）。后端通过 Playwright 原生 `.mouse.click()` 或 `xdotool` 下达系统级像素坐标点击。

**路线 B 关键执行细节（6 项）**：

1. **Docker 镜像选型**：第一版建议直接使用 `kasmweb/chrome`（已内置 Xvfb + VNC + Chromium，开箱即用）快速验证链路。链路跑通后再自建精简 Dockerfile 控制镜像体积（目标 < 2GB）。
2. **容器生命周期**：第一版每个 Run 按需拉起独立容器，Run 结束或超时后自动销毁。通过 `dockerode` 库操控 Docker Engine。后续可引入容器池化和预热策略。
3. **VNC WebSocket 鉴权**：不要让前端直接用 `?token=xxx` 连接 `websockify`。后端为每个容器签发一次性 `browser_session_id`，前端只连接同源后端代理；鉴权通过 HttpOnly Cookie 或 WebSocket 握手 `Authorization` 完成。`websockify` / VNC 服务只监听内网或本机，不直接暴露公网，session 随容器销毁失效。
4. **截图获取路径**：`computer_action` 工具每次操作后，通过 Playwright CDP 的 `Page.captureScreenshot` 获取高精度截图（而非 VNC 帧缓冲）。VNC 流仅用于前端实时转播，不参与 Agent 决策。
5. **分辨率与 DPI**：Xvfb 固定 `1280x720`，Chromium 启动参数加 `--force-device-scale-factor=1`。分辨率过高会导致截图文件过大、token 消耗激增。
6. **共享内存（致命坑）**：Docker 启动参数必须加 `--shm-size=1g`。容器默认 `/dev/shm` 只有 64MB，Chromium 打开复杂页面必崩。同时需预装 `fonts-noto-cjk` 等中文字体包，否则截图中文乱码。

当前实现没有把 Playwright 深度耦合到现有 executor 中，而是做成独立模块和工具层。

已新增模块：

```text
BrowserModule
  BrowserSessionService
ToolModule
  BrowserOpenTool
  BrowserExtractTool
  BrowserScreenshotTool
```

第一阶段已经开放只读能力（基于路线 A）：

1. `browser_open` / `browser_extract` / `browser_screenshot`

第二阶段将正式融合“路线 B”级别的视觉交互能力：

4. `browser_click` / `browser_type`（从 Selector 驱动兼容或变轨为视觉坐标驱动）

第三阶段将基于 VNC 转播提供**人工协助（HITL）扫码授权**与持久化 Session 登陆态。

### 7.4 会话模型

第一版暂不新增数据库表，采用进程内会话管理：

- `BrowserSessionService` 维护 `session_id -> context/page`
- `browser_open` 创建 session
- `browser_extract` 和 `browser_screenshot` 使用同一个 session
- Run 结束时 `AgentService.finally` 调用 `closeRun(runId)`
- `BROWSER_SESSION_TTL_MS` 控制闲置会话过期
- `BROWSER_MAX_SESSIONS_PER_RUN` 控制单个 Run 的会话数量

后续开放交互能力时，再新增 `browser_sessions` 表：

- `id`
- `task_id`
- `run_id`
- `status`
- `current_url`
- `title`
- `created_by_step_run_id`
- `created_at`
- `updated_at`
- `closed_at`

浏览器会话和 Run 绑定，Run 结束后自动关闭。

如果要支持点击、输入等交互，建议再加 `browser_actions` 表：

- `id`
- `session_id`
- `run_id`
- `step_run_id`
- `action_type`
- `selector`
- `url`
- `payload`
- `screenshot_artifact_id`
- `created_at`

### 7.5 安全边界

浏览器自动化是高风险能力，第一版已加入这些边界：

- 默认关闭，通过环境变量显式开启
- 禁止访问内网地址、metadata 地址、localhost
- 浏览器子请求也走 URL 安全检查，不允许加载被禁止地址
- 每个 Run 限制最多浏览器会话数
- Run 结束后自动关闭会话，闲置会话也会过期
- 禁止默认自动登录

仍需补齐：

- DNS 解析后的 IP 段检查
- 域名 allowlist / denylist
- 截图大小和总浏览器运行时长预算
- 交互工具的事件审计

### 7.6 推荐落地阶段

| 阶段 | 目标 | 状态 | 验收 |
| --- | --- | --- | --- |
| B0 | 同步 Playwright 依赖和构建 | 已完成 | 后端 `pnpm build` 通过 |
| B1 | 只读浏览器工具 | 已完成 | 可打开 JS 页面、抽取文本、截图到 workspace |
| B2 | 交互工具 | 待实现 | 可点击、输入、等待元素，所有动作有事件记录 |
| B3 | 受控登录态 | 待实现 | 只在明确配置的域名启用，不复用个人浏览器登录态 |

## 8. 代码执行沙箱

### 8.1 目标

让 Agent 不只是“生成代码”，而是能：

- 写代码到 workspace
- 在隔离环境中运行
- 捕获 stdout / stderr / exit code
- 把运行结果反馈给 evaluator

### 8.2 推荐技术路线

不建议直接在主进程里执行生成的代码。

推荐两种方案：

#### 方案 A：本地 Docker 沙箱

优点：

- 与当前 Node/Nest 架构兼容
- 成本低
- 可本地开发验证

缺点：

- 依赖宿主机 Docker
- 多租户隔离能力有限

#### 方案 B：远程沙箱服务

例如独立 Worker、容器服务或第三方沙箱。

优点：

- 更安全
- 更适合未来扩展

缺点：

- 复杂度更高

对当前项目，推荐先做 **方案 A**。

### 8.3 与“浏览器沙箱”的边界与终极结合

明确与第 7 章“浏览器自动化”的功能区别：
- **浏览器自动化**：解决“联网获取屏幕/文本”的信息输入问题。在初期阶段，它运行在宿主机的 Node 环境中作为只读爬虫。
- **代码执行沙箱**：解决“运行模型生成的不可信防代码”的副作用隔离问题。由于有宕机和注入风险，它必须从第一天起就隔离在跑着非特权用户的 Docker 环境中。

**大一统终极形态（The "Computer" Paradigm）**：
随着路线图推进，这两个孤立的隔离方案将在高阶 Agent 架构中发生**合体**。
未来，我们将只启动一个**包含了 Ubuntu + Node + Python + Chromium + Xvfb 虚拟屏幕的大一统 Docker 镜像**作为 Agent 独享的“云电脑”。大模型既可以通过网络协议在由于此 Docker 内浏览网页（浏览器自动化），也可以在此容器内执行分析脚本做图（代码执行）。这种集中化的 SandboxRunner 才是高级 Agent 的最终形态（参考 Anthropic Computer Use）。

### 8.4 `SandboxRunner` 接口设计

`SandboxRunner` 是沙箱能力的核心抽象。S0 阶段先定义接口，使用 MockRunner 跑通单元测试；S1 阶段再接入 `DockerRunner` 真实实现。

推荐使用 `dockerode`（npm 周下载量 500 万+）通过 Unix Socket `/var/run/docker.sock` 与 Docker Engine 通信。注意：宿主机的 Docker Socket 只暴露给 `SandboxService`，**绝不能挂载进沙箱容器自身**，否则容器可反控宿主机。

```ts
interface SandboxRunner {
  run(options: {
    taskId: string;
    runtime: 'node' | 'python';
    entryFile: string;
    timeoutMs: number;
    memoryLimitMb?: number;   // 默认 256
    networkDisabled?: boolean; // 默认 true
  }): Promise<{
    stdout: string;    // 截断至 maxOutputLength
    stderr: string;    // 截断至 maxOutputLength
    exitCode: number;
    durationMs: number;
    truncated: boolean; // stdout/stderr 是否被截断
  }>;
}
```

**Workspace 挂载的读写边界**：
- 沙箱内的 task workspace 以 `rw` 模式挂载（Agent 需要写代码文件进去）
- 基础镜像层以 `ro` 模式挂载
- 输出文件在沙箱内生成后，回写到宿主机 workspace，evaluator 才能读取

### 8.5 推荐工具设计

第一批工具建议保守设计，只开放固定运行时，不先开放任意命令和依赖安装：

1. `sandbox_run_node`
   - 输入：`task_id`, `entry`, `timeoutMs`
   - 输出：`stdout`, `stderr`, `exitCode`

2. `sandbox_run_python`
   - 输入：`task_id`, `entry`, `timeoutMs`

第二阶段再考虑：

3. `sandbox_install_dependencies`
   - 输入：`task_id`, `packageManager`, `packages`
   - 默认不开启，需要环境变量和审批策略

4. `sandbox_run_command`
   - 输入：`task_id`, `command`, `args`, `timeoutMs`
   - 仅允许命中白名单的命令

### 8.6 安全约束

必须限制：

- CPU
- 内存
- 磁盘
- 运行时长
- 网络访问

推荐默认策略：

- 无网络（`--network=none`）
- 只挂载当前 task workspace
- 只读基础镜像
- 禁止挂载宿主机 Docker socket
- 限制执行时长，例如 30 秒
- 限制 `stdout / stderr` 输出长度
- 运行结果不直接当作可信指令，只作为 evaluator 的输入材料

**生产级安全 checklist**（从课程演示升级到生产部署时逐项落实）：

- [ ] 容器内非 root 用户运行（`--user 1000:1000`）
- [ ] `--cap-drop=ALL`，不授予任何 Linux capability
- [ ] `--security-opt=no-new-privileges`
- [ ] `--pids-limit=100`，防止 fork bomb
- [ ] `--read-only` rootfs + `--tmpfs /tmp:size=100m`
- [ ] seccomp / AppArmor profile
- [ ] 镜像 digest pinning，防止 supply chain 攻击
- [ ] 容器超时后 `docker kill`（不只是 process kill）
- [ ] workspace 使用临时 copy-on-write 目录，执行成功后再 promote 产物到 task workspace
- [ ] 依赖安装（npm install / pip install）在独立沙箱中执行，不与代码执行共享文件系统
- [ ] `--shm-size=1g`（如果容器内运行 Chromium）
- [ ] 预装 `fonts-noto-cjk` 中文字体（如果容器内截图）

> ⚠️ 课程版本使用简化配置即可（前 7 项），但文档需明确声明安全边界。

### 8.7 与 evaluator 的联动

代码执行结果不应该只是产物，而应进入评估链路。

evaluator 判断依据可增加：

- `exitCode === 0`
- `stderr` 是否为空
- 输出是否包含预期关键词

### 8.7 推荐落地阶段

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| S0 | 抽象 `SandboxRunner` 接口 | 不依赖 Docker 也能用 mock runner 做单元测试 |
| S1 | 纯净 Docker runner 跑 Node/Python | 超时、输出截断、退出码都能写入 StepRun |
| S2 | 与代码生成结合并入 evaluator | 代码生成任务能自动根据执行结果 retry 或 fail |
| S3 | 容器合体演进 | 【架构跃迁】将浏览器依赖并入 Sandbox，实现统一的"云电脑环境" |

**S3 启动前置条件**：

- [ ] S1 的纯净 Docker runner 已稳定运行 2 周以上
- [ ] B2 的浏览器交互工具已通过 CDP 路线验证
- [ ] 前端 noVNC 组件已完成基础集成
- [ ] 大一统 Docker 镜像体积已控制在 2GB 以内（否则冷启动太慢）

## 9. 事件持久化回放

### 9.1 当前状态

当前系统已经有实时事件、持久化业务数据和事件日志表：

- 实时事件：`step.started / step.progress / tool.called / tool.completed / run.token_usage`
- 持久化数据：`plans / step_runs / artifacts / runs`
- 事件日志：`task_events`

当前后端已经把 `EventPublisher.emit()` 的 payload 异步写入 `task_events`，并提供：

- `GET /api/tasks/:id/events`

当前前端已经接入第一版回放：

- 首次进入任务详情时调用 `fetchTaskEvents`
- 使用 `applyLoggedEvent` 将历史事件还原成 `liveRunFeed`
- 运行中任务会把历史事件和 socket 实时事件合并，并通过 `_eventId` 去重

仍需补齐：

- 基于 `after_created_at + after_event_id` 的增量续拉
- WebSocket 断线重连后的补漏
- 事件保留策略
- 回放链路自动化测试

### 9.2 当前架构

`task_events` 表用于记录需要回放的细粒度事件。

当前字段：

- `id`
- `task_id`
- `run_id`
- `event_name`
- `payload` `jsonb`
- `created_at`

### 9.3 记录策略

第一版采用统一策略：通过 `EventPublisher` 发布的任务事件都会写入 `task_events`。后续如果事件量变大，再按 `event_name` 增加采样或保留策略。

### 9.4 回放方式

已新增接口：

1. `GET /api/tasks/:id/events`
   - 按 `created_at ASC` 返回事件流
   - 支持 `runId / take / skip`

后续可继续新增：

2. `GET /api/tasks/:id/runs/:runId/replay`
   - 返回完整回放视图

前端回放策略：

- 首次进入详情页时拉取历史事件
- 若 Run 已结束，则直接渲染历史回放
- 若 Run 正在执行，则历史事件 + socket 实时事件合并

**历史事件与实时事件的合并去重策略**：

前端从 REST 拉取历史事件和从 Socket 接收实时事件之间存在时间窗口重叠，必须处理去重和空窗问题：

1. 前端拉取历史事件后，记录最后一条事件的 `created_at + id` 复合游标
2. Socket 推送的新事件，如果 `_eventId` 已存在于本地事件集合中则跳过
3. 如果 socket 推送的事件 `_eventCreatedAt` 早于已有最后一条事件，也跳过
4. 后端 `GET /events` 已支持 `after_created_at + after_event_id`，前端断线重连后应从复合游标处增量续拉，避免全量重复加载

### 9.5 与现有架构的关系

`step_runs` 继续作为最终状态事实来源  
`task_events` 负责记录过程事实来源

两者分工应明确：

- `step_runs`：最终结果、查询、统计
- `task_events`：回放、调试、审计

## 10. 跨 Run 记忆（当前优先级：低）

### 10.1 当前状态

当前数据库中已经保存了历史：

- task
- revision
- run
- artifact
- stepRun

第一层 Task 级最近记忆已经接入：

- Planner 会读取当前 task 最近 3 次 completed run
- 只读取 JSON 摘要 artifact
- 以 `memoryContext` 注入 Planner
- 读取失败不阻断本次规划

也就是说，当前不是完全没有记忆，而是只有“同一 task 的最近摘要记忆”。

仍未实现：

- Artifact 级结构化复用
- 来源级复用
- 跨 task 相似主题匹配
- 记忆可信度标记
- 记忆过期策略

### 10.2 目标

让同一个 Task 或同主题任务在新的 Run 中能复用：

- 之前的调研结论
- 之前的来源列表
- 之前生成的 artifact
- 之前工具输出的摘要

### 10.3 推荐记忆分层

#### 第一层：Task 级最近记忆

最先做、性价比最高。

在 Planner 前读取当前 task 的最近历史：

- 最近 3 次 completed run
- 每次 run 的主要 artifact 摘要
- 重要 stepResults 摘要

注入到 Planner 的 `memoryContext` 中。

#### 第二层：Artifact 级复用

对历史 artifact 做结构化摘要，保存：

- `summary`
- `sources`
- `key_points`
- `artifact_type`

新 Run 开始时，如果任务主题相近，可优先复用这些摘要。

#### 第三层：来源级复用

为调研类任务单独维护 `source memories`：

- URL
- 标题
- 摘要
- 抓取时间
- 主题标签

新 Run 若命中相同主题，可优先引用或重新抓取这些来源。

### 10.4 推荐数据结构

第一阶段不引入向量数据库，先做关系型记忆即可。

可新增两张表：

1. `task_memory_snapshots`
   - `id`
   - `task_id`
   - `run_id`
   - `summary`
   - `key_points` `jsonb`
   - `sources` `jsonb`
   - `created_at`

2. `source_memories`
   - `id`
   - `task_id`
   - `url`
   - `title`
   - `summary`
   - `tags` `jsonb`
   - `last_seen_at`

### 10.5 注入方式

推荐只把“摘要后的记忆”注入到 Planner，而不是直接注入原始长文本。

Planner prompt 可新增：

- `recentMemoryContext`
- `recentArtifactsSummary`
- `sourceMemoryContext`

这样可以避免：

- token 爆炸
- 旧信息淹没当前任务
- 不可信外部内容直接进入主提示词

## 11. 多 Agent 编排

### 11.1 是否现在直接做多 Agent

不建议现在直接把系统改成多 Agent。

原因很直接：

- 事件不可回放
- side-effect 工具没有统一审批和审计
- 真实数据库、失败恢复和并发 run 测试仍不足
- 浏览器只有只读第一版，沙箱还没有接入

多 Agent 会放大这些问题。现在更稳的做法是：

1. 先把单 Agent 主链路稳定下来
2. 浏览器和沙箱先作为工具能力接入，浏览器已完成只读第一版
3. 再把“专门 Agent”做成 Skill
4. 最后抽出真正的多 Agent 编排层

### 11.2 推荐演进方式

#### 阶段 M1：Agent 作为 Skill

在现有 `Skill` 接口上扩展出“内部 Agent Skill”：

```ts
interface AgentSkill extends Skill {
  agentRole: 'researcher' | 'browser_operator' | 'coder' | 'reviewer' | 'packager';
}
```

示例：

- `research_agent_skill`
- `browser_agent_skill`
- `coding_agent_skill`
- `review_agent_skill`
- `packaging_agent_skill`

它们仍由当前 executor 调用，产出仍写入 `StepRun` 和 `Artifact`。这样不需要推翻当前数据模型。

#### 阶段 M2：受控并行

只允许 read-only Agent 并行，例如：

- 多个研究 Agent 并行查不同来源
- 浏览器只读抽取和网页搜索并行
- Reviewer 在产物生成后独立检查

side-effect Agent 仍串行执行。

#### 阶段 M3：Supervisor 编排

新增 `OrchestratorModule`，职责是：

- 根据任务类型选择 Agent
- 分配预算
- 汇总子 Agent 输出
- 处理失败和取消
- 写入事件和审计记录

建议新增数据表：

1. `agent_runs`
   - `id`
   - `task_id`
   - `run_id`
   - `parent_step_run_id`
   - `agent_name`
   - `role`
   - `status`
   - `input`
   - `output`
   - `error_message`
   - `started_at`
   - `completed_at`

2. `agent_messages`
   - `id`
   - `agent_run_id`
   - `role`
   - `content`
   - `metadata`
   - `created_at`

3. `agent_artifact_links`
   - `agent_run_id`
   - `artifact_id`

### 11.3 角色建议

第一批角色不要太多，建议控制在 5 个：

| Agent | 责任 | 默认权限 |
| --- | --- | --- |
| `researcher` | 搜索、抓取、汇总来源 | read-only |
| `browser_operator` | 浏览器渲染、抽取、截图 | read-only，第二阶段才允许交互 |
| `coder` | 生成代码、写文件、请求沙箱执行 | side-effect，需要工具策略 |
| `reviewer` | 检查产物质量、事实一致性、代码运行结果 | read-only |
| `packager` | 生成最终报告、摘要、交付文件 | side-effect |

### 11.4 多 Agent 的硬边界

多 Agent 不是让多个模型随意互相调用。必须有这些边界：

- 所有 Agent 共享同一个 `runId`
- 所有子任务都能被取消
- 所有工具调用都通过 `ToolRegistry`
- side-effect 工具只能由明确授权的 Agent 使用
- 子 Agent 输出必须摘要后交给上层，不直接把长原文塞回 Planner
- 每个 Agent 有 token、时间、工具调用次数预算
- 所有 Agent 的开始、完成、失败都写入 `task_events`

### 11.5 推荐接口

```ts
interface AgentWorkerInput {
  taskId: string;
  runId: string;
  parentStepRunId: string;
  objective: string;
  context: string;
  budget: {
    maxTokens: number;
    maxToolCalls: number;
    timeoutMs: number;
  };
}

interface AgentWorkerOutput {
  summary: string;
  artifacts: Array<{ title: string; type: string; content: string }>;
  sources: string[];
  confidence: number;
}
```

### 11.6 推荐落地阶段

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| M0 | 不改多 Agent，先补构建、测试、事件持久化 | 单 Agent 稳定 |
| M1 | Agent 作为 Skill | researcher/reviewer 可作为普通 Skill 被 Planner 调用 |
| M2 | read-only 并行 | 多个研究子任务可并行，事件和 token 可追踪 |
| M3 | Supervisor 编排 | `agent_runs` 可查询，失败、取消、预算都可控 |

## 12. 配置管理建议

### 12.1 运行时参数放进 `.env` 是否合理

结论：合理，而且这是最佳实践的一部分。

像下面这些都属于典型的运行时配置：

- `STEP_TIMEOUT_MS`
- `MAX_RETRIES`
- `MAX_REPLANS`
- `MAX_STEPS`
- `TOOL_CACHE_TTL_MS`
- `LLM_CACHE_ENABLED`
- `EXPORT_PDF_ENABLED`

它们本质上是：

- 运行策略
- 运维策略
- 部署策略

因此不应硬编码在业务代码里。

### 12.2 更完整的最佳实践

最佳实践不是“把值写进 `.env`”就结束，而是：

1. `.env` 作为配置来源
2. 通过统一配置层读取
3. 配置有 schema 校验
4. `.env.example` 是权威模板

### 12.3 当前建议

建议继续沿着现有方向收口：

#### 保留在 `.env` 的内容

- API Key
- Base URL
- 数据库连接
- 超时、重试、缓存 TTL
- 功能开关
- 目录路径

#### 不建议放 `.env` 的内容

- 长 Prompt 文本
- 模型价格大映射表
- Skill 语义定义
- Planner 复杂规则

这些更适合放：

- 代码常量
- 配置文件
- 独立 schema 配置模块

## 13. 推荐实施顺序

> 最后更新：2026-04-14。状态使用 5 级成熟度标签：未做 / 原型可用 / 演示稳定 / 工程可维护 / 生产级。

| 优先级 | 项目 | 成熟度 | 说明 | 下一步 |
|---|---|---|---|---|
| 0 | 构建恢复 | 工程可维护 | 后端、前端 build 均通过 | — |
| 1 | 依赖和 lockfile 同步 | 工程可维护 | 当前依赖可支持构建 | — |
| 2 | 关键路径测试 | 原型可用 | 后端已补初始测试 | 补真实 DB 集成测试、trajectory 回归测试 |
| 3 | Token / 成本观测 | 演示稳定 | Run 级统计 + 持久化 + model_name 已完成 | 补节点级 `llm_call_logs` |
| 4 | Planner 语义校验 | 工程可维护 | 注册、schema、stepIndex、side-effect 白名单 | 后续补人工审批和工具预算 |
| 5 | Workspace 清理 | 工程可维护 | 删除 + 定期扫描 | — |
| 6 | Task 级记忆（第一层） | 演示稳定 | 最近 3 次 run 的 JSON 摘要注入 Planner | — |
| 7 | 限流 | 工程可维护 | throttler 全局 + 任务创建单独限流 | — |
| 8 | Intent Router | 演示稳定 | 5 种意图分类 + 领域特化规划指引 | 高频意图改为固定 workflow 模板 |
| 9 | Executor Tool Calling | **演示稳定** | bindTools 动态参数决议 + Zod 校验 + 30s timeout + 动态工具 fail-closed 原型 | 补 fail-closed 单元测试、结构化 `errorCode` 和选择性 Tool Calling |
| 10 | Evaluator 增强 | 演示稳定 | 结构性错误分类 + retry 带上下文 + 分级超时 | — |
| 11 | 代码项目生成 | **演示稳定** | 单 Artifact 模式（1 次 LLM） | **待沙箱验证 + patch/fix loop 后升级** |
| 12 | PDF 中文支持 | 演示稳定 | Playwright HTML→PDF 渲染 | — |
| 13 | report-packaging 拆分 | 演示稳定 | 纯文本 Markdown + structured output 元数据 | — |
| 14 | 前端 Planner 状态文案 | 演示稳定 | plan.generating 事件 | — |
| 15 | 事件持久化回放 | **演示稳定** | **前端 replayEvents 第一版已接入** | 补游标增量拉取、保留策略、回放测试 |
| 16 | HTTP API Key | **演示稳定** | 写接口走 x-api-key | **⚠️ 仅演示保护，SPA 中 key 会暴露。生产需 session/JWT** |
| 17 | WebSocket 认证 | 原型可用 | 后端支持 token | 前端配置 + 部署说明 |
| 18 | 健康检查 | 工程可维护 | GET /api/health + DB | — |
| 19 | 浏览器只读 | 演示稳定 | Playwright open/extract/screenshot | 补真实 Chromium 冒烟测试 |
| 20 | **Planner 粒度升级** | **未做（架构关键）** | — | **Plan 从"工具调用+参数"升级为"能力步骤+objective"（Manus 模式），根治静态参数绑定问题** |
| 21 | **确定性 workflow** | **未做** | — | **高频意图（code_generation / research_report）代码直接返回固定计划，不经 LLM** |
| 22 | **代码执行沙箱** | **未做** | — | **Docker 方案 A，需带安全 checklist。代码生成闭环的前置条件** |
| 23 | Tool Calling fail-closed | 原型可用 | 动态参数工具已不 fallback 到 Planner 幻觉 | 补单元测试和结构化错误码 |
| 24 | 节点级 token 明细 | 未做 | — | llm_call_logs 表 |
| 25 | 每日配额表 | 未做 | — | api_clients + api_usage_daily |
| 26 | Artifact 级记忆（第二层） | 未做 | — | 结构化摘要复用 |
| 27 | 浏览器交互 | 未做 | — | click/type，VNC token 需改为 session 代理方式 |
| 28 | 多 Agent 编排 | 未做 | — | 先 Agent Skill → Supervisor |

### 13.1 第一个迭代：工程健康

目标：把“构建可用”提升为“主链路可验证”。

已完成：

1. 同步 backend/frontend 的依赖和 lockfile
2. 修复后端 `ChatOpenAI.modelName` 类型问题
3. 修复后端 `PlanSchema._type` 类型问题
4. 修复前端 `mermaid` 依赖和 `svg` 类型问题
5. 后端、前端 `pnpm build` 通过
6. 后端补 TaskService 主链路、Planner 语义校验、Agent 配置和 token 统计测试
7. 后端 e2e 改为 `/api/tasks` 冒烟测试，并对齐全局 `/api` 前缀
8. `.env.example` 补 CORS、WebSocket、LLM、结构化输出和导出相关配置项
9. 补 HTTP API Key、事件持久化、Workspace 定期清理、Planner side-effect 策略
10. 接入浏览器只读能力：`browser_open / browser_extract / browser_screenshot`

下一步继续完成：

1. 补 `cancelRun`、`deleteTask`、`finalizeRun` 的服务层测试
2. 补 retry/replan 超限把 run 标记为 failed 的 Agent 层测试
3. 补 `GET /api/health` e2e 和异常过滤器输出格式测试
4. 补 `task_events` 断线重连增量续拉和历史回放测试

### 13.2 第二个迭代：编排层架构升级（向 Manus 模式演进）

目标：解决"静态计划绑定动态参数"的根本架构问题。

建议顺序：

1. **Planner 粒度升级**：PlanSchema 输出从 `toolHint + toolInput` 升级为 `skillName + objective`。Planner 只规划"做什么"，不绑定"用什么 URL / 写什么内容"
2. **确定性 workflow**：`code_generation`、`research_report`、`competitive_analysis` 三种高频意图代码直接返回固定计划（不调 LLM Planner）
3. **Tool Calling 降级为兜底**：Planner 粒度升级后，大多数动态参数在 Skill 内部决议，Tool Calling 只处理 `general` 类型的裸 tool 步骤
4. 补 Planner 回归测试（mock LLM → 断言输出的 plan 结构正确）

### 13.3 第三个迭代：单 Agent 可维护性

目标：把当前单 Agent 主链路变得可回看、可审计、可保护。

建议顺序：

1. 基于 `after_created_at + after_event_id` 做事件增量续拉和断线补漏
2. 给 `task_events` 增加保留策略和分页游标测试
3. 增加 `api_clients / api_usage_daily` 配额表
4. 补真实数据库集成测试

### 13.4 第四个迭代：高价值执行能力

目标：让系统能处理动态网页和代码验证。

建议顺序：

1. 浏览器部署验证：确认目标环境已安装 Chromium，并补一条真实页面冒烟测试
2. SandboxRunner 抽象和 mock 测试
3. Docker 沙箱跑 Node/Python
4. `code_generation` workflow 升级为 `generate → sandbox_run → fix → package` 闭环
5. evaluator 根据沙箱结果做 retry / fail
6. 浏览器交互工具：click / type / wait_for

### 13.5 第五个迭代：记忆与多 Agent

目标：在主链路稳定后，再提升复用和任务分工能力。

建议顺序：

1. Artifact 级记忆
2. Source 级记忆
3. `research_agent_skill`
4. `review_agent_skill`
5. read-only 并行
6. `agent_runs` 和 Supervisor 编排

## 14. 本阶段建议结论

**已经完成的核心能力：**

1. 单 Agent 主执行链路已成型
2. Task / Revision / Run / Plan / StepRun / Artifact 模型已成型
3. 工具、Skill、实时事件、产物预览已经可用
4. Run 级 token 后端统计和持久化已经有基础
5. 并发锁、事务后发事件、删除清理、优雅关闭等稳定性措施已经开始补上
6. 后端和前端生产构建已经通过
7. 浏览器只读工具已接入，默认关闭，可通过环境变量启用
8. HITL（Human-in-the-loop）完整链路已实现：`interrupt()` + `MemorySaver` + `Command` resume
9. Planner Guardrail Chain 安全防护已接入
10. **Intent Router 意图路由 + 领域特化规划策略已接入**
11. **Executor Tool Calling 动态参数决议已接入（`llm.bindTools` + Zod 校验 + 30s timeout + AbortSignal）**
12. **Evaluator 结构性错误分类 + retry 带上下文已接入**
13. **代码项目生成已改为单 Artifact 模式（1 次 LLM 生成所有文件）**
14. **PDF 导出已改用 Playwright 渲染，原生支持中文**
15. **report-packaging 已拆分为纯文本 Markdown 生成 + structured output 元数据提取**
16. **分级超时：STEP_TIMEOUT_MS（Tool 路径）/ SKILL_TIMEOUT_MS（Skill 路径，默认 5 分钟）**

**当前最大问题（按优先级排序）：**

1. **代码执行沙箱缺失**——生成代码但不能验证，是当前最大能力缺口
2. **Tool Calling fail-closed 仍缺测试和结构化错误**——动态参数工具已进入 fail-closed 原型，但还需要单元测试、`errorCode` 和前端文案收口
3. **高频任务缺固定 workflow**——Intent Router 只注入 prompt 指引，`code_generation` 应走 hardcoded generate→run→fix→package 闭环
4. 测试缺少真实 DB 集成、trajectory 回归（mock LLM → 断言 plan/step/event 顺序）
5. 产物不支持增量编辑，只能整体重新生成
6. API Key 在 SPA 中暴露，仅为演示保护
7. Tool Calling 对所有 tool step 生效，参数完整的 step 仍有不必要的 LLM 调用开销

**Token 总预算建议**：

在 `AgentState` 中增加 `totalTokenBudget` 字段（默认 100,000），evaluator 在每次决策前检查已消耗 token 是否超过预算。超预算时直接终止 Run 并标记失败原因为 `token_budget_exceeded`，避免死循环 replan 烧毁大量费用。

**已知的架构局限性（需显式声明）**：

- 当前 HITL 使用的 `MemorySaver` 是纯内存 checkpointer，**进程重启后所有 checkpoint 数据丢失**。对于课程项目和单实例部署完全可接受。如果未来需要生产化或多实例部署，应切换为 `PostgresSaver`（LangGraph 官方提供）。

**下阶段核心目标（按优先级排序）：**

1. **Planner 粒度升级 + 确定性 workflow**（P0，架构关键）—— 把 Planner 输出从"工具调用 + 参数"升级为"能力步骤 + objective"。高频意图（code_generation / research_report / competitive_analysis）代码直接返回固定计划，不经 LLM。这是从 Plan-then-Execute 向 Manus 模式演进的核心一步。
2. **代码执行沙箱 S0/S1**（P1）—— 让代码生成从"写了就算"变为"写了能跑能验"。必须带安全 checklist。沙箱接入后 code_generation workflow 升级为 `generate → sandbox_run → fix → package` 闭环。
3. **Tool Calling fail-closed 补全**（P1）—— 为动态参数工具补单元测试，失败时带 `errorCode`。Planner 粒度升级后，多数动态参数问题在 Skill 内部解决，Tool Calling 退化为兜底。
4. **事件回放补全**（P2）—— 游标增量拉取、断线补漏、保留策略、回放测试。
5. **节点级 token 明细**（P2）—— `llm_call_logs`，定位 planner/evaluator/skill 谁烧钱。
6. **多 Agent**（P3）—— 等沙箱、事件、预算、审批都稳了再做。
