# Mini-Manus 后续增强技术方案

## 1. 文档目标

本文档用于承接 `Mini-Manus` 当前版本之后的下一阶段建设，重点覆盖以下能力：

1. 轻量认证、限流、API 配额保护
2. Token / 成本观测
3. Planner 语义校验
4. Workspace 生命周期清理
5. 浏览器自动化
6. 代码执行沙箱
7. 事件持久化回放
8. 跨 Run 记忆

本方案默认遵循以下原则：

- 继续保持单 Agent 主线，不引入多 Agent 协调复杂度
- 不推翻现有 `task -> revision -> run -> plan -> step_run -> artifact` 数据模型
- 继续使用 `socket.io` 作为主实时通道
- 优先做“明显提升任务闭环能力”的能力，而不是盲目扩 Scope
- 本阶段不建设正式 Evaluation Harness

## 2. 当前现状评估

> **文档更新说明**（2026-04-09）：本节已按最新实现状态同步更新，§12 实施顺序同步修订。

### 2.1 已经具备的能力

当前系统已经具备以下能力（含本阶段新增）：

**核心执行链**
- 任务中心：创建、编辑、重试、取消、历史 Run 回看
- Agent 执行闭环：planner → executor → evaluator → finalizer
- 实时反馈：步骤开始、progress、tool 调用、tool 完成、artifact 创建
- 多产物：`markdown / json / code / diagram / file`

**工具与 Skill**
- 工具层：网页搜索、网页抓取（静态）、Markdown 抽取、文件读写、目录读取、文件下载、PDF 文本提取、GitHub 搜索、PDF 导出
- Skill 层：调研、文档写作、竞品对比、briefing、产物审阅、报告打包

**稳定性与安全（本阶段补全）**
- Bug 修复：retry/replan 超限正确标 FAILED、finalizeRun/startRun 悲观锁、createTask 事务后发事件、cancel 分支补 step.failed 事件、deleteTask 事务删除
- 提示词安全：用户输入注入检测（detectInjection）+ 6 个 prompt 安全声明
- Planner 语义校验：skillName/toolHint 注册校验 + safeParse 输入校验 + 带错误反馈最多两次重试
- 速率限制：`@nestjs/throttler`，全局 60次/分，任务创建 10次/分
- WebSocket 认证：`WS_AUTH_TOKEN` 环境变量开启 token 鉴权
- 配置校验：Zod schema 校验必填项，启动时失败快速抛出

**可观测性（本阶段新增）**
- Token 统计：Run 级聚合（输入/输出/总计）+ 实时推送前端 RunDebugPanel
- Token 持久化：`task_runs` 新增 `input_tokens / output_tokens / total_tokens / estimated_cost_usd` 列（migration 已运行）
- 成本估算：内置模型价格表（gpt-4o / gpt-4o-mini / qwen-plus / deepseek 等）
- 健康检查：`GET /api/health` 含 DB 连通性探测
- 请求日志：`LoggingInterceptor` 记录每个 HTTP 请求耗时

**资源治理（本阶段新增）**
- Workspace 清理：deleteTask 事务提交后自动清理任务目录
- Task 级跨 Run 记忆（第一层）：Planner 从最近 3 次 completed run 的 JSON 摘要中读取历史上下文
- 优雅关闭：`enableShutdownHooks` + `OnModuleDestroy` 中止所有 in-flight run

**配置**
- 配置化运行参数：`MAX_RETRIES / MAX_REPLANS / MAX_STEPS / STEP_TIMEOUT_MS / TOOL_CACHE_TTL_MS / LLM_CACHE_ENABLED / EXPORT_PDF_ENABLED`
- `.env.example` 与实际 `.env` 同步，含注释说明

### 2.2 当前主要缺口

以下能力尚未实现，按优先级排列：

#### 执行能力缺口

- 无浏览器自动化，只能处理静态抓取场景（动态 JS 渲染页面拿不到）
- 无代码执行沙箱，代码生成后无法运行验证
- Skill 内部工具调用仍以串行为主，缺少并行执行

#### 可观测性缺口

- 事件没有持久化，无法真正回放执行过程（刷新后 live feed 消失）
- 节点级 LLM 调用明细（planner/evaluator/finalizer/skill 各用了多少 token）尚无独立表记录

#### 记忆与生命周期缺口

- Workspace 定期清理（定时任务扫描超期目录）尚未实现
- Artifact 级记忆复用（第二层）和来源级记忆（第三层）尚未实现
- 输出截断仍偏粗暴，长内容没有先摘要再截断

#### 认证与配额缺口

- HTTP 接口无 API Key 认证（WebSocket 已有 token 鉴权）
- 无每日配额表（`api_clients` / `api_usage_daily`）
- 无浏览器会话、代码执行等高价值闭环能力

## 3. 轻量认证、限流与 API 配额保护

### 3.1 目标

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

你这版已经把 Token 统计做到了“第一阶段可用”，而且方向是对的。

当前已经实现的链路：

1. 后端在单个 Run 内聚合所有 LLM 调用的 token 用量
2. 支持兼容多种 usage 字段路径
3. Run 结束后通过 `run.token_usage` 事件推送给前端
4. 前端 `Run Debug` 面板可以显示：
   - `Input Tokens`
   - `Output Tokens`
   - `Total Tokens`

也就是说，当前系统已经具备：

- `Run 级别 token 聚合`
- `实时展示`

### 4.2 当前缺口

当前实现还差以下关键点：

1. 没有成本估算
2. 没有持久化到数据库
3. 刷新页面后 token 信息会丢失
4. 没有分节点统计：
   - planner
   - evaluator
   - finalizer
   - skill 内部 LLM
5. 没有价格配置表，无法按模型估算成本

### 4.3 推荐架构

#### 第一阶段：补 Run 级持久化

推荐直接在 `task_runs` 上增加这些字段：

- `input_tokens`
- `output_tokens`
- `total_tokens`
- `estimated_cost_usd`
- `model_name`

优点：

- 改动小
- 最容易接进现有 `Run Detail`
- 前端刷新后仍能看到数据

#### 第二阶段：补节点级明细

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

#### 第三阶段：价格配置

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

1. 先把 Run 级 token 持久化
2. 再补成本估算
3. 最后再做节点级明细

## 5. Planner 语义校验

### 5.1 当前状态

当前 Planner 已经有结构校验：

- `steps` 数组
- `stepIndex`
- `description`
- `skillName / skillInput`
- `toolHint / toolInput`

但还缺语义层面的校验。

### 5.2 当前风险

Planner 结构合法，不代表计划能执行。当前仍可能出现：

1. `skillName` 不存在
2. `toolHint` 不存在
3. `toolInput` 与工具 schema 不匹配
4. `skillInput` 与 skill schema 不匹配
5. 一个 step 同时给了 `skillName` 和 `toolHint`
6. 一个 step 两者都没给
7. `stepIndex` 重复、跳号或乱序
8. 读写副作用工具被 Planner 无约束地滥用

### 5.3 推荐架构

新增 `PlanSemanticValidator`，位置放在：

```text
planner llm output
    -> PlanSchema 结构校验
    -> PlanSemanticValidator 语义校验
    -> savePlan
```

### 5.4 语义校验规则

第一版建议固定这些规则：

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
- 对高风险工具可增加显式开关，例如：
  - `ENABLE_BROWSER_AUTOMATION`
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

但 `cleanTaskDir()` 还没有真正纳入任务生命周期。

### 6.2 当前风险

如果长期运行，`/tmp/mini-manus-workspaces` 会持续累积：

- 下载的文件
- 中间产物
- 导出的 PDF
- 调试残留文件

### 6.3 推荐策略

#### 场景一：删除任务时立即清理

在 `deleteTask(taskId)` 事务成功后，调用：

```ts
await workspace.cleanTaskDir(taskId)
```

注意顺序：

1. 先取消 Run
2. 先删除数据库记录
3. 事务提交成功后再删目录

不要把文件删除放在数据库事务内部。

#### 场景二：定期清理过期工作区

新增一个定时清理任务，例如每 6 小时执行一次。

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
- 点击
- 输入
- 提取表格与局部内容

### 7.2 推荐技术选型

推荐直接使用 `Playwright`。

原因：

- Node.js 生态成熟
- 支持 Chromium / Firefox / WebKit
- 适合网页自动化与截图
- 后续如果要做登录态、复杂页面操作，也更容易扩展

### 7.3 推荐接入方式

不建议一开始就把 Playwright 深度耦合到现有 executor 中，推荐先把它做成独立工具层。

第一批浏览器工具建议：

1. `browser_open`
   - 输入：`url`
   - 输出：页面标题、最终 URL、会话 ID

2. `browser_extract`
   - 输入：`sessionId`, `selector?`
   - 输出：页面文本或指定区域文本

3. `browser_click`
   - 输入：`sessionId`, `selector`

4. `browser_type`
   - 输入：`sessionId`, `selector`, `text`

5. `browser_screenshot`
   - 输入：`sessionId`, `path`

### 7.4 会话模型

新增 `browser_sessions` 表：

- `id`
- `task_id`
- `run_id`
- `status`
- `current_url`
- `created_at`
- `updated_at`

浏览器会话和 Run 绑定，Run 结束后自动关闭。

### 7.5 安全边界

浏览器自动化是高风险能力，建议增加这些边界：

- 默认关闭，通过环境变量显式开启
- 域名 allowlist / denylist
- 禁止访问内网地址、metadata 地址、localhost
- 禁止默认自动登录
- 所有点击、输入、导航都记录事件

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

### 8.3 推荐工具设计

第一批工具：

1. `sandbox_run_node`
   - 输入：`task_id`, `entry`, `timeoutMs`
   - 输出：`stdout`, `stderr`, `exitCode`

2. `sandbox_run_python`
   - 输入：`task_id`, `entry`, `timeoutMs`

3. `sandbox_install_dependencies`
   - 输入：`task_id`, `packageManager`, `packages`
   - 默认先不要开放

### 8.4 安全约束

必须限制：

- CPU
- 内存
- 磁盘
- 运行时长
- 网络访问

推荐默认策略：

- 无网络
- 只挂载当前 task workspace
- 只读基础镜像
- 限制执行时长，例如 30 秒
- 限制输出长度

### 8.5 与 evaluator 的联动

代码执行结果不应该只是产物，而应进入评估链路。

evaluator 判断依据可增加：

- `exitCode === 0`
- `stderr` 是否为空
- 输出是否包含预期关键词

## 9. 事件持久化回放

### 9.1 当前状态

当前系统已经有实时事件和持久化业务数据：

- 实时事件：`step.started / step.progress / tool.called / tool.completed / run.token_usage`
- 持久化数据：`plans / step_runs / artifacts / runs`

但细粒度事件没有真正落库，因此：

- 刷新页面后 live feed 会消失
- 无法真正做“执行回放”

### 9.2 推荐架构

新增 `task_events` 表，用于记录所有需要回放的细粒度事件。

建议字段：

- `id`
- `task_id`
- `run_id`
- `step_run_id`
- `event_name`
- `sequence`
- `payload` `jsonb`
- `created_at`

### 9.3 记录策略

不是所有事件都要记录。

建议第一版持久化这些事件：

- `run.started`
- `plan.created`
- `step.started`
- `step.progress`
- `tool.called`
- `tool.completed`
- `step.completed`
- `step.failed`
- `artifact.created`
- `run.failed`
- `run.completed`
- `run.cancelled`
- `run.token_usage`

### 9.4 回放方式

新增接口：

1. `GET /tasks/:id/runs/:runId/events`
   - 返回事件流

2. `GET /tasks/:id/runs/:runId/replay`
   - 返回按 sequence 排序的完整回放视图

前端回放策略：

- 首次进入详情页时拉取历史事件
- 若 Run 已结束，则直接渲染历史回放
- 若 Run 正在执行，则历史事件 + socket 实时事件合并

### 9.5 与现有架构的关系

`step_runs` 继续作为最终状态事实来源  
`task_events` 负责记录过程事实来源

两者分工应明确：

- `step_runs`：最终结果、查询、统计
- `task_events`：回放、调试、审计

## 10. 跨 Run 记忆

### 10.1 当前状态

当前数据库中已经保存了历史：

- task
- revision
- run
- artifact
- stepRun

但这些历史并没有被重新注入到新的 Planner / Executor 上下文里。

也就是说：

- 历史“已保存”
- 但 Agent 还没有真正“记住”

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

## 11. 配置管理建议

### 11.1 运行时参数放进 `.env` 是否合理

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

### 11.2 更完整的最佳实践

最佳实践不是“把值写进 `.env`”就结束，而是：

1. `.env` 作为配置来源
2. 通过统一配置层读取
3. 配置有 schema 校验
4. `.env.example` 是权威模板

### 11.3 当前建议

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

## 12. 推荐实施顺序

> 最后更新：2026-04-09。✅ 表示已完成，⏳ 表示待实现。

| 优先级 | 项目 | 状态 | 说明 |
|---|---|---|---|
| 1 | Token 持久化 + 成本估算 | ✅ 已完成 | task_runs 新增 4 列，MODEL_PRICING 内置 |
| 2 | Planner 语义校验 | ✅ 已完成 | skillName/toolHint 注册校验 + safeParse + 带错误反馈重试 |
| 3 | Workspace 删除清理 | ✅ 已完成 | deleteTask 事务后调 cleanTaskDir |
| 4 | Task 级跨 Run 记忆（第一层） | ✅ 已完成 | 最近 3 次 completed run 的 JSON 摘要注入 Planner |
| 5 | 限流 | ✅ 已完成 | @nestjs/throttler，全局 + 任务创建单独限流 |
| 6 | WebSocket 认证 | ✅ 已完成 | WS_AUTH_TOKEN，生产环境必填 |
| 7 | 健康检查 | ✅ 已完成 | GET /api/health，含 DB 连通性 |
| 8 | 事件持久化回放 | ⏳ 待实现 | 需新增 task_events 表，改 Gateway 写库 |
| 9 | Artifact 级记忆（第二层）| ⏳ 待实现 | 读取历史 artifact 做结构化摘要复用 |
| 10 | Workspace 定期清理 | ⏳ 待实现 | 定时任务扫描超期目录 |
| 11 | 节点级 token 明细 | ⏳ 待实现 | 新增 llm_call_logs 表，按 node 拆分统计 |
| 12 | HTTP API Key 认证 | ⏳ 待实现 | x-api-key 全局 Guard |
| 13 | 每日配额表 | ⏳ 待实现 | api_clients + api_usage_daily |
| 14 | 浏览器自动化 | ⏳ 待实现 | Playwright，browser_sessions 表 |
| 15 | 代码执行沙箱 | ⏳ 待实现 | Docker 方案 A，最复杂，放最后 |

### 下一步建议顺序

**立即可做（低复杂度，高价值）：**

1. **事件持久化**（§9）：新增 `task_events` 表，在 Gateway 写库，前端支持历史回放。这是产品感提升最明显的一步。

2. **HTTP API Key 认证**（§3）：加 `ApiKeyGuard`，`APP_API_KEYS` 环境变量配置，15 分钟内可完成。

3. **Workspace 定期清理**：在 `TaskService.onModuleInit` 里加一次性扫描，再接 NestJS `@Cron` 定时任务。

**中期（中等复杂度）：**

4. 节点级 token 明细（需新表 + TokenTracker 分 node 统计）

5. Artifact 级记忆复用（需读历史 artifact + 摘要策略）

**长期（高复杂度，高价值）：**

6. 浏览器自动化（Playwright + 会话管理 + 安全边界）

7. 代码执行沙箱（Docker + 资源限制 + evaluator 联动）

## 13. 本阶段建议结论

**已完成的核心目标：**

1. ✅ Token 统计已做到”可持久化、可估算成本”
2. ✅ Planner 已做到”结构合法 + 语义合法”，连续失败可终止 Run
3. ✅ Workspace 已有基础生命周期（删除时清理）
4. ✅ Task 级历史记忆已注入 Planner，同主题任务可复用上次调研结论
5. ✅ 系统稳定性大幅提升：并发锁、事务、优雅关闭、速率限制均已到位

**当前系统定位：**

从”能跑起来”升级到了”稳定可用、可观测、有基础资源治理”。

**下阶段核心目标：**

把执行过程做成”可回放、可审计”（事件持久化），再上浏览器自动化与代码沙箱把闭环能力做实。
