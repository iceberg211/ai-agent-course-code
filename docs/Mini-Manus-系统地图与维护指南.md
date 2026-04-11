# Mini-Manus 系统地图与维护指南

## 1. 这份文档解决什么问题

随着 `Mini-Manus` 代码量继续增长，尤其在大量使用 AI 生成代码的情况下，项目很容易出现下面这些症状：

- 功能越来越多，但越来越难解释系统到底怎么工作
- 改一个点，不确定会不会破坏别的链路
- 能看懂局部代码，但抓不住全局结构
- 越到后期越依赖“感觉”和“记忆”做判断

这份文档的目标不是让我们一次性重新读懂所有代码，而是帮我们建立一套更稳的项目掌控方式：

1. 先掌握系统地图
2. 再掌握关键链路
3. 再明确高风险边界
4. 最后用文档、测试、调试面板和变更纪律把项目稳住

一句话概括：

**我们不追求记住所有细节，而是追求始终知道系统的中枢在哪里、风险在哪里、改动怎么验证。**

## 2. 项目总览

### 2.1 系统定位

`Mini-Manus` 当前本质上是一个：

- 单 Agent 任务执行器
- 以 `task / revision / run` 为核心状态模型
- 以 `planner -> executor -> evaluator -> finalizer` 为核心执行链
- 以 `tool / skill / artifact` 为核心能力层
- 以前后端实时联动为核心体验层

它已经不是一个简单 demo，而是一个有明确领域模型的 Agent 系统。

### 2.2 后端模块地图

后端入口在 [app.module.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/app.module.ts)。

当前主要模块职责如下：

| 模块 | 责任 |
| --- | --- |
| `TaskModule` | 任务生命周期、revision/run 队列、查询接口 |
| `AgentModule` | 执行图、LLM、planner/executor/evaluator/finalizer |
| `ToolModule` | 原子工具注册与调用 |
| `SkillModule` | 复合能力封装 |
| `WorkspaceModule` | 工作目录、文件边界、路径安全 |
| `EventModule` | 事件发布 |
| `GatewayModule` | WebSocket 推送、task room |
| `DatabaseModule` | PostgreSQL / TypeORM 接入 |
| `HealthModule` | 健康检查 |

### 2.3 前端模块地图

前端任务中心入口在 [index.tsx](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/pages/task-center/index.tsx)。

当前前端可以按“页面壳 + 领域模块”理解：

| 模块 | 责任 |
| --- | --- |
| `pages/task-center` | 任务中心页面整体布局 |
| `domains/task` | 任务列表、任务摘要、编辑、socket 同步 |
| `domains/run` | run 详情、时间线、debug 面板 |
| `domains/plan` | 计划显示 |
| `domains/artifact` | 产物预览与切换 |
| `core/api` | React Query、请求层 |
| `core/socket` | socket.io 客户端 |
| `store` | 前端选择态 |

### 2.4 当前完成度快照

> 更新时间：2026-04-11，基于 `mini-manus/backend` 和 `mini-manus/frontend` 代码与本地构建结果。

当前完成度可以这样判断：

| 维度 | 状态 | 判断 |
| --- | --- | --- |
| 核心领域模型 | 已成型 | `task / revision / run / plan / step_run / artifact` 模型完整，已经具备任务历史和产物记录 |
| Agent 主链路 | 已成型 | `planner -> executor -> evaluator -> finalizer` 已接入 LangGraph，支持 retry、replan、cancel 和 finalizer 产物生成 |
| 工具与 Skill | 可用但仍需治理 | 工具注册、缓存、side-effect 类型、文件边界已有基础；浏览器、沙箱、高风险工具授权还没有 |
| 实时体验 | 可用但不可回放 | socket live feed 已完整接入；细粒度事件没有落库，刷新后只剩数据库最终态 |
| 可观测性 | 后端部分完成 | Run 级 token 字段和实时事件已实现；前端 debug 面板仍主要依赖 live token，刷新后展示不完整 |
| 安全与资源治理 | 基础阶段 | 有输入校验、简单提示词防护、URL 私网正则拦截、限流、WebSocket token；HTTP API Key、配额、审批和 DNS 级 SSRF 防护未完成 |
| 测试与构建 | 当前不达标 | 后端和前端构建当前失败；测试仍是 Nest 默认样例，未覆盖核心链路 |

一句话结论：

**Mini-Manus 已经完成“单 Agent 任务系统骨架和主要业务链路”，但还没有到“可长期稳定迭代”的阶段。现在最优先的不是直接叠浏览器、沙箱、多 Agent，而是先做一次工程收口，把构建、测试、事件持久化和接口安全补稳。**

### 2.5 当前已发现的问题

本次检查跑了后端和前端构建，发现这些问题需要优先处理：

1. 后端 `pnpm build` 当前失败。
   - `package.json` 已声明 `@nestjs/swagger`、`@nestjs/throttler`、`@nestjs/terminus`、`pdf-lib`、`pdf-parse`，但当前 `pnpm-lock.yaml` 和 `node_modules` 没有同步。
   - 代码层还有两个类型问题：`ChatOpenAI` 类型上没有 `modelName`；Zod v4 下 `PlanSchema._type` 不可用，应改成 `z.infer<typeof PlanSchema>` 或显式类型。

2. 前端 `pnpm build` 当前失败。
   - `package.json` 已声明 `mermaid`，但当前安装状态和 lockfile 没有同步。
   - `artifact-section.tsx` 动态导入 `mermaid` 后，`svg` 解构参数没有类型。

3. 测试没有真正覆盖 Mini-Manus。
   - 后端 `app.controller.spec.ts` 和 e2e 测试仍是 Nest 默认 `Hello World` 样例。
   - 当前缺少 `create -> run -> complete`、`cancel`、`retry`、`edit -> new revision`、`artifact generated` 等关键路径测试。

4. 文档和代码状态已经出现漂移。
   - 增强方案里把部分能力写成“已完成”，但实际只有后端部分完成，前端展示、回放、配额、定期清理等还没有。
   - 后续每次引入新能力，都要同步更新这份系统地图和增强方案。

5. 高风险能力还没有统一治理层。
   - `Tool` 有 `read-only / side-effect` 分类，但没有统一审批、白名单、运行预算和审计记录。
   - 浏览器和沙箱一旦接入，不能直接暴露给 Planner 任意调用，必须先有工具安全策略。

## 3. 先掌握这 5 条关键链路

你现在不需要先读完所有工具和 skill，最应该掌握的是下面这 5 条链路。

### 3.1 任务创建链路

目标问题：

- 一个任务是怎么从输入变成开始执行的？

核心入口：

- [task.controller.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/task/task.controller.ts)
- [task.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/task/task.service.ts)

核心过程：

1. 前端提交任务输入
2. 后端创建 `task`
3. 后端创建 `revision v1`
4. 后端创建 `run #1`
5. 如果当前 task 没有正在运行的 run，则立即激活
6. `AgentService.executeRun()` 开始执行

你必须能回答这几个问题：

- `task`、`revision`、`run` 的关系是什么
- 为什么要有 revision
- 新建任务时到底是谁触发了执行

### 3.2 Agent 执行链路

目标问题：

- 一个 run 是怎么一步一步执行完的？

核心入口：

- [agent.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/agent.service.ts)
- [planner.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/planner.node.ts)
- [executor.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/executor.node.ts)
- [evaluator.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/evaluator.node.ts)
- [finalizer.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/finalizer.node.ts)

核心语义：

1. `planner` 负责生成计划
2. `executor` 负责执行当前步骤
3. `evaluator` 负责判断：
   - `continue`
   - `retry`
   - `replan`
   - `complete`
   - `fail`
4. `finalizer` 负责把最终结果整理成 artifact

你必须能讲清楚：

- `currentStepIndex` 什么时候推进
- `retry` 和 `replan` 的区别是什么
- 一个 run 为什么会结束

### 3.3 实时反馈链路

目标问题：

- 为什么前端能看到“运行中过程”？

核心入口：

- [agent.gateway.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/gateway/agent.gateway.ts)
- [use-task-socket-sync.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/domains/task/hooks/use-task-socket-sync.ts)
- [timeline-section.tsx](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/domains/run/components/timeline-section.tsx)
- [run-debug-panel.tsx](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/domains/run/components/run-debug-panel.tsx)

核心语义：

1. 后端发布事件
2. Gateway 按 task room 推给前端
3. 前端 `liveRunFeed` 内存态接收事件
4. 时间线、摘要区、debug 面板即时更新
5. 持久化数据仍通过 React Query 保证最终一致性

你必须能讲清楚：

- 哪些信息来自数据库
- 哪些信息来自 live event
- 为什么刷新页面后部分实时态会消失

### 3.4 数据落库链路

目标问题：

- 一个步骤、一个计划、一个产物最终写到了哪里？

核心实体：

- `Task`
- `TaskRevision`
- `TaskRun`
- `TaskPlan`
- `PlanStep`
- `StepRun`
- `Artifact`

核心入口：

- [task.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/task/task.service.ts)
- [task.module.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/task/task.module.ts)

你必须能回答：

- `planner` 输出的 plan 最终存到哪
- `executor` 的结果最终落到哪
- artifact 是在哪里保存的

### 3.5 前端任务中心展示链路

目标问题：

- 任务中心现在这几个区块分别吃什么数据？

核心入口：

- [index.tsx](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/pages/task-center/index.tsx)

主要区块：

1. `TaskSidebar`：任务列表
2. `TaskSummaryPanel`：任务摘要、revision/run 切换、运行态
3. `PlanSection`：计划
4. `TimelineSection`：执行过程
5. `RunDebugPanel`：调试指标
6. `ArtifactSection`：产物预览

## 4. 如果只读 30 分钟，先读这些文件

这是你后面最值得熟悉的一组文件。

### 第一组：系统中枢

1. [task.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/task/task.service.ts)
2. [agent.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/agent.service.ts)
3. [planner.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/planner.node.ts)
4. [executor.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/executor.node.ts)
5. [evaluator.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/evaluator.node.ts)
6. [finalizer.node.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/agent/nodes/finalizer.node.ts)

### 第二组：实时链路

1. [agent.gateway.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/gateway/agent.gateway.ts)
2. [use-task-socket-sync.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/domains/task/hooks/use-task-socket-sync.ts)
3. [run-debug-panel.tsx](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/frontend/src/domains/run/components/run-debug-panel.tsx)

### 第三组：能力边界

1. [tool.interface.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/tool/interfaces/tool.interface.ts)
2. [tool.registry.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/tool/tool.registry.ts)
3. [skill.interface.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/skill/interfaces/skill.interface.ts)
4. [skill.registry.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/skill/skill.registry.ts)
5. [workspace.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/workspace/workspace.service.ts)

## 5. 高风险边界清单

这些地方不是“代码复杂”而已，而是最容易出真实问题的边界。

### 5.1 Tool / Skill 边界

高风险点：

- side-effect 工具是否被错误调用
- tool input 是否匹配 schema
- skill 内部是否绕过缓存或安全边界
- 错误是否被正确传递给 evaluator

后续改动时必须问自己：

- 这是 read-only 还是 side-effect
- 它会不会产生不可逆副作用
- 失败时 evaluator 能否拿到清晰上下文

### 5.2 Workspace 边界

高风险点：

- 路径穿越
- 临时文件泄露
- 长期不清理导致磁盘膨胀
- 未来接浏览器自动化 / 沙箱后文件边界失控

任何跟文件相关的改动，都要优先经过：

- [workspace.service.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/workspace/workspace.service.ts)

### 5.3 Prompt 与不可信内容边界

高风险点：

- 用户输入注入
- 网页/PDF/文件内容中的恶意指令
- 历史 artifact 被当成可信指令再次注入

当前你已经有用户输入级别的基础防护：

- [prompt-safety.ts](/Users/hewei/Documents/GitHub/ai-agent-course-code/mini-manus/backend/src/common/utils/prompt-safety.ts)

但后面继续做浏览器自动化、跨 run 记忆时，这个边界会更重要。

### 5.4 并发与状态边界

高风险点：

- 同一个 task 并发启动多个 run
- cancel / retry / edit 交错时状态错乱
- finalizeRun 激活 pending run 时出现竞态

核心判断点：

- 当前系统有软排队
- 也开始有悲观锁保护
- 但这依然属于高风险链路

### 5.5 实时态与持久态边界

高风险点：

- 前端看到的东西不一定都在数据库里
- live feed 刷新后会丢
- 用户以为“可回放”，其实只是“正在看内存态”

这部分后续如果加事件持久化，就要特别小心：

- 不能混淆“最终状态”和“过程事件”

### 5.6 依赖与构建边界

高风险点：

- `package.json` 增加依赖后，`pnpm-lock.yaml` 没有同步
- 本地 `node_modules` 与 lockfile 不一致，导致别人拉代码后构建失败
- 依赖升级后类型 API 变化，例如 `ChatOpenAI.modelName`、Zod v4 类型推导
- 前端动态导入库后没有类型约束，构建阶段才暴露问题

当前已经出现这类问题：

- 后端缺少 `@nestjs/swagger`、`@nestjs/throttler`、`@nestjs/terminus`、`pdf-lib`、`pdf-parse` 的 lockfile 与安装同步
- 前端缺少 `mermaid` 的 lockfile 与安装同步
- 后端存在两个真实 TypeScript 类型错误

后续任何新增依赖的改动，都必须同时满足：

1. `package.json`、`pnpm-lock.yaml` 一起更新
2. 后端执行 `pnpm build`
3. 前端执行 `pnpm build`
4. 若新增运行时配置，同步更新 `.env.example`

## 6. AI 项目最容易失控的地方

这里我想把问题说得更直接一点。

AI 生成项目的最大风险，不是“写得烂”，而是：

**没人真正知道哪些地方可以安全改，哪些地方一碰就会破链。**

最常见的失控模式有这几种：

1. 功能加得很快，但系统地图没有同步更新
2. 每个改动都像局部优化，累计后耦合度越来越高
3. 改动说明只说“做了什么”，不说“影响了什么”
4. 没有关键路径测试，只能靠人工试一下
5. 配置和代码默认值慢慢漂移

如果不主动治理，后面就会进入：

- 不敢删代码
- 不敢重构
- 只能继续堆功能

## 7. 后续和 AI 协作，建议改成这套方式

从现在开始，不建议再只用这种提问方式：

- “帮我实现这个功能”
- “帮我改一下这里”

更稳的方式是每次都要求 AI 同时给出这 4 件事：

### 7.1 改动范围

必须说明：

- 改哪些模块
- 不改哪些模块
- 这次改动是能力扩展、修复、还是重构

### 7.2 影响链路

必须说明：

- 会不会影响 `task -> revision -> run`
- 会不会影响 `planner -> executor -> evaluator -> finalizer`
- 会不会影响实时事件
- 会不会影响 artifact 展示

### 7.3 风险点

必须说明：

- 哪些状态最容易回归
- 哪些并发场景可能出问题
- 哪些安全边界可能被打破

### 7.4 验证方式

必须说明：

- 怎么验证没把关键链路搞坏
- 需要跑哪些任务
- 哪些 UI 行为要确认

一句话原则：

**以后让 AI 不只是交付代码，也必须交付“影响说明”和“验证说明”。**

## 8. 变更模板

后续无论你自己做，还是继续让 AI 帮你做，我都建议每次改动都按下面这个模板整理。

### 8.1 改动模板

```md
## 改动目标

## 影响模块
- 

## 不影响模块
- 

## 关键链路影响
- 

## 风险点
- 

## 验证方式
- 
```

### 8.2 为什么这个模板重要

它的作用不是“写文档好看”，而是强迫我们在改代码前先想清楚：

- 这是局部改动还是链路改动
- 这次修改到底会影响哪些地方
- 有没有验证链路

## 9. 质量护栏：别追求全面，先守住关键路径

你现在最需要的不是“一下子把测试补满”，而是先建立最小但关键的护栏。

### 9.0 第零层：构建必须先恢复

在继续做功能之前，先把构建恢复为绿色：

1. 重新同步 `mini-manus/backend` 和 `mini-manus/frontend` 的 `pnpm-lock.yaml`
2. 修复后端 `ChatOpenAI.modelName` 类型访问问题
3. 修复后端 `PlanSchema._type` 类型写法
4. 修复前端 `mermaid` 依赖与 `svg` 类型问题
5. 确认后端、前端都能通过 `pnpm build`

这一步不属于功能开发，但它决定后面能不能稳定迭代。

### 9.1 第一层：类型与配置

必须持续保持：

- TypeScript 严格类型
- `zod` schema 校验
- 环境变量校验
- tool / skill 输入 schema

### 9.2 第二层：关键路径测试

优先补这几条，不追求大而全：

1. `create -> run -> complete`
2. `cancel`
3. `retry`
4. `edit -> new revision`
5. `artifact generated`

### 9.3 第三层：调试面板

你现在已经有 `Run Debug`，这是非常好的方向。

后面可以继续把这类信息收进去：

- token
- cost
- cache hit/miss
- error category
- step durations

这种信息的价值非常高，因为它会替代大量“去读日志”和“猜系统状态”的时间。

## 10. 每周一次的“收缩周期”

AI 项目非常容易只扩张不收缩。

所以建议你建立一个固定节奏：

**每做 2~3 个功能，就做一次收缩周期。**

收缩周期不做新功能，只做这些事：

1. 删除重复逻辑
2. 抽公共类型和 helper
3. 更新系统地图文档
4. 更新风险边界清单
5. 补关键测试
6. 校对 `.env.example`
7. 校对默认值和配置是否漂移

这个节奏会极大降低“项目越来越像黑盒”的风险。

## 11. 你现在最该守住的 10 个问题

以后每次你觉得“我已经开始不确定系统在干嘛了”，就回来检查这 10 个问题。

1. 创建任务后，谁触发了第一轮执行？
2. 当前 run 为什么是 `running / completed / failed / cancelled`？
3. 一个 step 的结果最终写到了哪里？
4. `retry` 和 `replan` 的边界是什么？
5. 当前前端看到的是数据库状态还是 live feed？
6. artifact 是在哪一层生成和保存的？
7. 当前 tool 调用失败时，evaluator 能拿到什么上下文？
8. 当前 token 是按什么粒度统计的？
9. 当前 workspace 的文件什么时候创建、什么时候清理？
10. 当前 side-effect 能力有没有被明确约束？

如果这 10 个问题你讲不清楚，说明项目不是“代码太多”，而是“系统可见性变弱了”。

## 12. 推荐的下一步动作

基于目前项目状态，不建议马上直接做浏览器、沙箱、多 Agent。推荐先按下面顺序推进：

1. **恢复构建**：修复依赖、lockfile、TypeScript 类型问题，让后端和前端都能 `pnpm build`。
2. **补关键路径测试**：先覆盖 `create -> run -> complete`、`cancel`、`retry`、`edit -> new revision`、`artifact generated`。
3. **补事件持久化**：新增 `task_events`，让时间线和工具调用可以刷新后回看。
4. **补 HTTP API Key**：写操作加 `x-api-key`，避免匿名用户直接触发模型调用。
5. **补 Run Debug 持久展示**：前端类型和 debug 面板读取 `task_runs` 中的 token 与成本字段。
6. **再做浏览器自动化**：第一版只做只读渲染、文本抽取和截图，不先开放点击和输入。
7. **再做代码沙箱**：第一版只跑受限命令，不开放依赖安装和网络。
8. **最后做多 Agent**：先用“Agent 作为 Skill”的方式接入，不先改掉当前主执行图。

判断是否可以进入下一阶段，只看三个条件：

- 构建是否通过
- 关键测试是否覆盖本阶段受影响链路
- 文档是否同步更新当前能力边界

## 13. 最后一句

对于 AI 生成项目，真正的掌控力不是来自“我记住了所有代码”，而是来自：

- 我知道系统怎么分层
- 我知道关键链路怎么走
- 我知道哪些地方最危险
- 我知道每次改动该怎么验证

只要这 4 点持续成立，项目即使继续变大，也不会失控。
