# Mini-Manus 后续增强技术方案

## 1. 文档目标

本文档用于承接 `Mini-Manus` 当前版本之后的下一阶段建设，重点覆盖以下能力：

1. 构建、测试、依赖和配置收口
2. 轻量认证、限流、API 配额保护
3. Token / 成本观测
4. Planner 语义校验
5. Workspace 生命周期清理
6. 事件持久化回放
7. 浏览器自动化
8. 代码执行沙箱
9. 跨 Run 记忆
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

> **文档更新说明**（2026-04-12）：工程健康已复核，后端和前端 `pnpm build` 均通过；后端已补初始单元测试和 e2e 冒烟测试，当前 `pnpm test` 为 5 个测试套件、13 条测试，`pnpm test:e2e` 为 1 个测试套件、3 条测试。

### 2.1 已经具备的能力

当前系统已经具备以下能力：

**核心执行链**
- 任务中心：创建、编辑、重试、取消、历史 Run 回看
- Agent 执行链路：planner → executor → evaluator → finalizer
- 实时反馈：步骤开始、progress、tool 调用、tool 完成、artifact 创建
- 多产物：`markdown / json / code / diagram / file`

**工具与 Skill**
- 工具层：网页搜索、网页抓取（静态）、Markdown 抽取、文件读写、目录读取、文件下载、PDF 文本提取、GitHub 搜索、PDF 导出
- Skill 层：调研、文档写作、竞品对比、briefing、产物审阅、报告打包
- 工具有 `read-only / side-effect` 分类，read-only 工具支持简单缓存

**稳定性与安全**
- retry/replan 超限可标记 FAILED
- `startRun`、`finalizeRun` 使用 task 行悲观锁降低并发错乱风险
- `createTask` 事务提交后再发事件和启动执行
- cancel 分支会补 `step.failed` 事件
- deleteTask 使用事务删除数据库记录，并在事务提交后清理 workspace
- 提示词安全：用户输入注入检测（detectInjection）+ 6 个 prompt 安全声明
- Planner 语义校验：`skillName/toolHint` 注册校验 + `safeParse` 输入校验 + `stepIndex` 顺序校验 + 带错误反馈最多两次重试
- 速率限制：`@nestjs/throttler`，全局 60次/分，任务创建 10次/分
- WebSocket 认证：`WS_AUTH_TOKEN` 环境变量开启 token 鉴权
- 配置校验：Zod schema 校验必填项，启动时失败快速抛出

**可观测性**
- Token 统计：Run 级聚合（输入/输出/总计）+ 实时推送前端 RunDebugPanel
- Token 持久化：`task_runs` 新增 `input_tokens / output_tokens / total_tokens / estimated_cost_usd` 列
- 成本估算：内置模型价格表（gpt-4o / gpt-4o-mini / qwen-plus / deepseek 等）
- 前端 Run Debug：优先展示实时 token 数据，刷新后回退读取持久化 token 和成本字段
- 健康检查：`GET /api/health` 含 DB 连通性探测
- 请求日志：`LoggingInterceptor` 记录每个 HTTP 请求耗时

**资源治理**
- Workspace 清理：deleteTask 事务提交后自动清理任务目录
- Task 级跨 Run 记忆（第一层）：Planner 从最近 3 次 completed run 的 JSON 摘要中读取历史上下文
- 优雅关闭：`enableShutdownHooks` + `OnModuleDestroy` 中止所有 in-flight run

**配置**
- 配置化运行参数：`MAX_RETRIES / MAX_REPLANS / MAX_STEPS / STEP_TIMEOUT_MS / TOOL_CACHE_TTL_MS / LLM_CACHE_ENABLED / EXPORT_PDF_ENABLED`

**工程健康**
- 后端 `pnpm build` 通过
- 前端 `pnpm build` 通过
- 后端 `pnpm test` 已覆盖 TaskService 主链路、Planner 语义校验、Agent 配置和 token 统计
- 后端 `pnpm test:e2e` 已覆盖 `/api/tasks` 列表、创建和 DTO 校验
- 后端 `ChatOpenAI.modelName` 类型问题已通过 `AgentService.modelName` 收口
- 后端 `PlanSchema._type` 类型问题已改为 `z.infer<typeof PlanSchema>['steps']`
- 前端 `mermaid` 依赖已可参与构建

### 2.2 部分完成但需要收口的能力

以下能力已经有代码基础，但还不能按“稳定完成”看待：

| 能力 | 当前状态 | 需要补齐 |
| --- | --- | --- |
| Token / 成本观测 | Run 级统计、持久化、实时事件、前端刷新后展示已完成 | 还缺 `model_name` 追溯和节点级明细 |
| Planner 语义校验 | 已校验执行器存在、input schema、`stepIndex` 顺序/重复/跳号 | 还缺 side-effect 白名单策略和规划阶段步数限制 |
| 配置管理 | `ConfigModule` + Zod schema 已接入，`.env.example` 已补 CORS / WebSocket / LLM / 导出相关项 | 下一步应把更多运行时开关纳入 schema 显式校验 |
| WebSocket 认证 | 配 token 时可鉴权 | 前端需统一配置 `VITE_WS_AUTH_TOKEN`，生产环境部署要有密钥注入说明 |
| Workspace 清理 | 删除任务时会清理目录 | 缺定期扫描，进程异常或手动删除数据库后仍可能残留目录 |
| Task 级记忆 | Planner 可读取最近 completed run 的 JSON 摘要 | 只按 task 读取，没有 artifact/source 级记忆，也没有相似任务匹配 |
| 工程健康 | 构建已恢复，后端初始业务测试已补 | 前端仍无自动化测试，前端 Mermaid 相关 chunk 偏大 |

### 2.3 当前主要缺口

以下能力尚未实现，按优先级排列：

#### 工程健康缺口

- 后端已有初始业务测试，但还没有覆盖真实数据库集成、Agent 图执行失败恢复和并发 run 场景
- e2e 已对齐 `/api/tasks` 冒烟场景，但还没有覆盖 `GET /api/health` 和异常过滤器输出格式
- 前端没有自动化测试
- 前端生产构建通过，但 Mermaid 相关 chunk 较大，需要后续做产物渲染的按需加载和 chunk 策略

#### 执行能力缺口

- 无浏览器自动化，只能处理静态抓取场景（动态 JS 渲染页面拿不到）
- 无代码执行沙箱，代码生成后无法运行验证
- Skill 内部工具调用仍以串行为主，缺少并行执行
- 无多 Agent 编排层，所有任务仍由单一执行图推进

#### 可观测性缺口

- 事件没有持久化，无法真正回放执行过程（刷新后 live feed 消失）
- 节点级 LLM 调用明细（planner/evaluator/finalizer/skill 各用了多少 token）尚无独立表记录
- 工具调用只有 live 事件和 stepRun 字段，没有独立审计表

#### 记忆与生命周期缺口

- Workspace 定期清理（定时任务扫描超期目录）尚未实现
- Artifact 级记忆复用（第二层）和来源级记忆（第三层）尚未实现
- 输出截断仍偏粗暴，长内容没有先摘要再截断

#### 认证与配额缺口

- HTTP 接口无 API Key 认证（WebSocket 已有 token 鉴权）
- 无每日配额表（`api_clients` / `api_usage_daily`）
- 无浏览器会话、代码执行等高价值执行能力

### 2.4 阶段判断

当前项目处在：

**单 Agent 核心系统已成型，构建健康和后端初始测试已恢复，但事件回放、写接口保护和前端测试还没达到长期维护标准。**

因此下一阶段不要直接从多 Agent 开始。多 Agent 会放大已有问题：事件不可回放、side-effect 无审批、工具审计不足。正确顺序是先补事件持久化、HTTP 认证和前端可观测性，再把浏览器和沙箱作为能力模块接入，最后再做多 Agent 编排。

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

当前实现还差以下关键点：

1. `task_runs` 没有 `model_name` 字段，成本估算无法追溯具体模型
2. 没有分节点统计：
   - planner
   - evaluator
   - finalizer
   - skill 内部 LLM
3. 价格表在代码常量中，暂时没有配置覆盖能力

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

#### 第二阶段：补 model_name

在 `task_runs` 上增加：

- `model_name`

这样历史 Run 的成本估算才可审计。

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
3. `task_runs` 增加 `model_name`
4. 最后再做节点级明细

## 5. Planner 语义校验

### 5.1 当前状态

当前 Planner 已经有结构校验和部分语义校验：

- `steps` 数组
- `stepIndex`
- `description`
- `skillName / skillInput`
- `toolHint / toolInput`
- `skillName` 是否注册
- `toolHint` 是否注册
- `skillInput / toolInput` 是否通过 schema
- `stepIndex` 是否按数组顺序从 0 连续递增，是否存在重复或跳号
- 语义校验失败时，最多带错误反馈重试一次

这部分方向正确，基础规则已覆盖，下一步重点是副作用工具治理和规划阶段步数限制。

### 5.2 当前风险

当前仍可能出现：

1. 读写副作用工具被 Planner 无约束地使用
2. 高风险工具没有按任务类型或环境变量做启用控制
3. Planner 输出的步骤数量虽然受 `MAX_STEPS` 控制执行，但规划阶段没有先限制计划长度
4. schema 错误信息对 Planner 仍偏底层，复杂对象修正效果不稳定

### 5.3 推荐架构

现有位置是正确的：

```text
planner llm output
    -> PlanSchema 结构校验
    -> PlanSemanticValidator 语义校验
    -> savePlan
```

### 5.4 语义校验规则

`PlanSemanticValidator` 已经覆盖基础规则，下一步建议继续补副作用和高风险工具规则：

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
- `deleteTask(taskId)` 事务提交后调用 `cleanTaskDir(taskId)`

也就是说，“删除任务时清理目录”已经纳入任务生命周期。

当前还缺两件事：

1. 定期清理过期目录
2. 进程异常、数据库手动删除、任务长时间失败后产生的残留目录治理

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

新增一个定时清理任务，例如每 6 小时执行一次。

建议新增：

- `WorkspaceCleanupService`
- `@nestjs/schedule` 的 `ScheduleModule`
- 配置项：`WORKSPACE_RETENTION_DAYS`
- 配置项：`WORKSPACE_CLEANUP_ENABLED`

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

不建议一开始就把 Playwright 深度耦合到现有 executor 中，推荐先做成独立模块和工具层。

建议新增模块：

```text
BrowserModule
  BrowserSessionService
  BrowserPolicyService
  BrowserToolFactory / browser tools
```

`executor` 仍然只通过 `ToolRegistry` 调用工具，不直接依赖 Playwright。

第一阶段只开放只读能力：

1. `browser_open`
   - 输入：`url`
   - 输出：页面标题、最终 URL、会话 ID

2. `browser_extract`
   - 输入：`sessionId`, `selector?`
   - 输出：页面文本或指定区域文本

3. `browser_screenshot`
   - 输入：`sessionId`, `path`
   - 输出：截图文件路径和 metadata

第二阶段再开放交互能力：

4. `browser_click`
   - 输入：`sessionId`, `selector`

5. `browser_type`
   - 输入：`sessionId`, `selector`, `text`

6. `browser_wait_for`
   - 输入：`sessionId`, `selector`, `timeoutMs`

第三阶段才考虑登录态和人工接管。

不要第一版就做登录态复用，因为它会带来账号安全、Cookie 存储、权限隔离和审计问题。

### 7.4 会话模型

新增 `browser_sessions` 表：

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

浏览器自动化是高风险能力，建议增加这些边界：

- 默认关闭，通过环境变量显式开启
- 域名 allowlist / denylist
- 禁止访问内网地址、metadata 地址、localhost
- URL 安全检查不能只靠字符串正则，后续要补 DNS 解析后的 IP 段检查
- 禁止下载任意大文件，截图和下载都要限制大小
- 每个 Run 限制最多浏览器会话数、页面数、动作数和总时长
- 禁止默认自动登录
- 所有点击、输入、导航都记录事件

### 7.6 推荐落地阶段

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| B0 | 同步 Playwright 依赖和构建 | 后端 `pnpm build` 通过 |
| B1 | 只读浏览器工具 | 可打开 JS 页面、抽取文本、截图成 artifact |
| B2 | 交互工具 | 可点击、输入、等待元素，所有动作有事件记录 |
| B3 | 受控登录态 | 只在明确配置的域名启用，不复用个人浏览器登录态 |

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

第一批工具建议保守设计，不先开放依赖安装：

1. `sandbox_run_node`
   - 输入：`task_id`, `entry`, `timeoutMs`
   - 输出：`stdout`, `stderr`, `exitCode`

2. `sandbox_run_python`
   - 输入：`task_id`, `entry`, `timeoutMs`

3. `sandbox_run_command`
   - 输入：`task_id`, `command`, `args`, `timeoutMs`
   - 仅允许命中白名单的命令

第二阶段再考虑：

4. `sandbox_install_dependencies`
   - 输入：`task_id`, `packageManager`, `packages`
   - 默认不开启，需要环境变量和审批策略

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
- 禁止挂载宿主机 Docker socket
- 限制执行时长，例如 30 秒
- 限制 `stdout / stderr` 输出长度
- 运行结果不直接当作可信指令，只作为 evaluator 的输入材料

### 8.5 与 evaluator 的联动

代码执行结果不应该只是产物，而应进入评估链路。

evaluator 判断依据可增加：

- `exitCode === 0`
- `stderr` 是否为空
- 输出是否包含预期关键词

### 8.6 推荐落地阶段

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| S0 | 抽象 `SandboxRunner` 接口 | 不依赖 Docker 也能用 mock runner 做单元测试 |
| S1 | Docker runner 跑 Node/Python 文件 | 超时、输出截断、退出码都能写入 StepRun |
| S2 | evaluator 读取运行结果 | 代码生成任务能自动根据执行结果 retry 或 fail |
| S3 | 依赖安装白名单 | 只允许指定包管理器和包名，默认关闭网络 |

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

- 当前构建还没通过
- 事件不可回放
- side-effect 工具没有统一审批和审计
- 核心链路测试不足
- 浏览器和沙箱还没有接入

多 Agent 会放大这些问题。现在更稳的做法是：

1. 先把单 Agent 主链路稳定下来
2. 浏览器和沙箱先作为工具能力接入
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

> 最后更新：2026-04-12。状态分为：已完成、部分完成、待实现。

| 优先级 | 项目 | 状态 | 说明 |
|---|---|---|---|
| 0 | 构建恢复 | 已完成 | 后端、前端 `pnpm build` 均通过 |
| 1 | 依赖和 lockfile 同步 | 已完成 | 当前依赖可支持后端、前端构建 |
| 2 | 关键路径测试 | 部分完成 | 后端已补 TaskService、Planner、Agent 配置、token 统计和任务 API e2e 初始测试 |
| 3 | Token 持久展示 | 已完成 | 前端类型、API 映射、RunDebugPanel 和实时事件均已接入 `estimatedCostUsd` |
| 4 | Planner 语义校验 | 部分完成 | 注册、schema、stepIndex 顺序/重复/跳号已做，side-effect 策略未做 |
| 5 | Workspace 删除清理 | 已完成 | deleteTask 事务后调 cleanTaskDir |
| 6 | Task 级跨 Run 记忆（第一层） | 已完成 | 最近 3 次 completed run 的 JSON 摘要注入 Planner |
| 7 | 限流 | 已完成 | @nestjs/throttler，全局 + 任务创建单独限流 |
| 8 | WebSocket 认证 | 部分完成 | 后端支持 token，`.env.example` 已补示例；前端和部署说明仍需补齐 |
| 9 | 健康检查 | 已完成 | GET /api/health，含 DB 连通性 |
| 10 | HTTP API Key 认证 | 待实现 | x-api-key 全局 Guard |
| 11 | 事件持久化回放 | 待实现 | 需新增 task_events 表，改事件发布链路 |
| 12 | Workspace 定期清理 | 待实现 | 定时扫描超期目录 |
| 13 | Artifact 级记忆（第二层） | 待实现 | 读取历史 artifact 做结构化摘要复用 |
| 14 | 节点级 token 明细 | 待实现 | 新增 llm_call_logs 表，按 node 拆分统计 |
| 15 | 每日配额表 | 待实现 | api_clients + api_usage_daily |
| 16 | 浏览器自动化 | 待实现 | Playwright，先只读，再交互 |
| 17 | 代码执行沙箱 | 待实现 | Docker 方案 A，默认无网络 |
| 18 | 多 Agent 编排 | 待实现 | 先 Agent Skill，再 Supervisor |

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

下一步继续完成：

1. 补 `cancelRun`、`deleteTask`、`finalizeRun` 的服务层测试
2. 补 retry/replan 超限把 run 标记为 failed 的 Agent 层测试
3. 补 `GET /api/health` e2e 和异常过滤器输出格式测试
4. 将更多运行时开关纳入 `app.module.ts` 的 Zod schema 显式校验

### 13.2 第二个迭代：单 Agent 可维护性

目标：把当前单 Agent 主链路变得可回看、可审计、可保护。

建议顺序：

1. Planner 补 side-effect 策略和规划阶段步数限制
2. HTTP API Key 认证
3. 事件持久化 `task_events`
4. Workspace 定期清理

### 13.3 第三个迭代：高价值执行能力

目标：让系统能处理动态网页和代码验证。

建议顺序：

1. 浏览器只读工具：open / extract / screenshot
2. 浏览器交互工具：click / type / wait_for
3. SandboxRunner 抽象和 mock 测试
4. Docker 沙箱跑 Node/Python
5. evaluator 根据沙箱结果做 retry / fail

### 13.4 第四个迭代：记忆与多 Agent

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

**当前最大问题：**

1. 测试还没有覆盖真实数据库集成、失败恢复和并发 run 场景
2. 事件不能回放
3. HTTP 写接口没有 API Key
4. 高风险工具还没有统一策略
5. `.env.example` 与实际 Zod 配置没有完全对齐

**下阶段核心目标：**

先把单 Agent 系统修到“关键链路有测试、执行过程可回放、写接口受保护、调试信息刷新后仍可见”，再上浏览器自动化、代码沙箱和多 Agent。这样后期维护成本会低很多。
