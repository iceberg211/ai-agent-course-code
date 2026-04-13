# Mini-Manus Agent 开发规则（前端）

## 前置阅读
- 开始开发前必须先阅读 `mini-manus/CLAUDE.md`。
- 前端实现必须对齐 `docs/简易版-Manus-技术方案总览.md` 中的“任务中心 UI”结构与交互语义。

## 前端 Skill 使用约束
- 前端界面与交互实现必须使用以下 skill 思路：
  - `frontend-skill`：负责页面结构、视觉层级、动效节奏、移动端适配。
  - `vercel-react-best-practices`：负责 React 组件拆分、状态更新、渲染性能与包体积控制。
- 在提交实现时，需确保“任务列表 + 任务详情 + 计划 + 时间线 + 产物预览”是完整可用流程，而不是模板页。

## 包管理与命令
- `mini-manus/frontend` 目录统一使用 `pnpm`。
- 禁止使用 `npm`/`yarn` 安装依赖或执行脚本。
- 常用命令：
  - `pnpm install`
  - `pnpm dev`
  - `pnpm build`
  - `pnpm lint`

## 前端工程约束
- 导入路径统一使用根路径别名 `@/`，禁止 `../` 相对路径导入。
- 避免使用跨层级 barrel import（如统一 `index.ts` 大导出），优先直接路径导入，减少无效打包。
- 状态职责分层：
  - `Jotai`：页面本地 UI 状态（选中任务、选中 run、选中产物、视图开关等）。
  - `TanStack Query`：服务端数据状态（任务列表、任务详情、run 详情）。
- 与后端交互统一走：
  - REST：任务列表、任务详情、创建、取消、重试、编辑。
  - WebSocket（socket.io）：任务事件实时同步与快照更新。
- 页面必须同时支持桌面端和移动端，避免只在宽屏下可用。

## 组件化与文件拆分硬性规则
- `App.tsx` 只做应用装配：Provider、路由入口、页面挂载，不承载任务中心业务细节。
- 页面容器（如 task-center page）只做编排，不写业务请求细节和复杂数据整理。
- 单文件过大时必须拆分：
  - 页面容器建议不超过 180 行。
  - 普通组件建议不超过 160 行。
  - Hook 建议不超过 140 行。
- 禁止“一个大 Hook 返回大量变量”的写法；超过 8 个返回字段必须拆分 Hook 或改为领域对象。
- 业务面板必须组件化拆分，例如：
  - `TaskSidebar`
  - `TaskSummaryPanel`
  - `PlanSection`
  - `TimelineSection`
  - `ArtifactSection`

## Hook 设计规则（必须遵守）
- 一个 Hook 只负责一个方向：
  - `selection`：当前选中态（Jotai）。
  - `queries`：列表与详情查询（TanStack Query）。
  - `actions`：创建、取消、重试、编辑等命令。
  - `sync`：WebSocket 订阅与缓存同步。
- Hook 返回值要面向调用方最小化，禁止把无关状态一并暴露给页面。
- 重计算数据放到 `useMemo`，事件回调放到 `useCallback`，避免无意义重渲染。
- 查询与事件常量统一维护在 `lib` 或 `constants`，禁止在组件中散落字符串。

## 合理目录结构（前端：领域驱动设计轻量版 DDD-Lite）
- 目标：按照业务实体（Domain）水平切分，解耦过度集中的 `features/task-center`，让各个模型独立自治，而在 `pages` 层面进行组装。
- 基于《技术方案总览》数据模型拆分出 `task` / `run` / `plan` / `artifact` 四大领域。

```text
src/
  app/                    # 应用外壳与装配
    App.tsx               # 路由入口与页面挂载
    main.tsx              # React 启动与全局 Provider
    styles/               # 全局样式 (index.css)
  
  core/                   # 核心基建资源 (不受具体业务影响)
    api/                  # REST 请求实例配置与通用错误拦截
    socket/               # WebSocket 连接池与事件总线中心

  domains/                # 领域模型层 (按业务实体切分，高度聚合)
    task/                 # 任务领域
      components/         # TaskSidebar (任务列表), TaskSummaryPanel (任务概要)
      hooks/              # useTaskQueries, useTaskActions, useTaskSelection
      types/              # 任务自身专属类型 (不含外部依赖)
    run/                  # 执行与控制领域
      components/         # RunController (运行状态条)
      hooks/              # useRunControl (取消/重试控制)
      types/
    plan/                 # 计划与时间线领域
      components/         # PlanSection (目标与计划树), TimelineSection (带 Skill Trace 的执行步骤)
      hooks/
      types/
    artifact/             # 产物领域
      components/         # ArtifactViewer (文本/Markdown预览)
      types/

  pages/                  # 顶层页面容器编排层
    task-center/          # 任务中心总页面 (负责各域组件拼装布局)
      index.tsx           # 排版：左侧 TaskSidebar，右侧 TaskSummary + Plan/Timeline + Artifact

  shared/                 # 跨领域共享层
    ui/                   # 高度复用的无状态组件 (Button, Modal, StatusItem 等)
    utils/                # 日期、文本转换等纯函数
    types/                # 全局通用类型 (Enums, Status 等)
    store/                # 全局应用级轻量状态 (非特定领域状态)
```

## 迁移与验收要求
- 每次开发后执行：
  - `pnpm lint`
  - `pnpm build`
- 必查项：
  - 无 `zustand` 依赖与引用残留。
  - 无 `../` 相对导入残留（统一使用 `@/`）。
  - 严禁存在“巨型 Hook”（如单个 Hook 返回超 8 个变量且承担查询+同步+交互组合逻辑）。
