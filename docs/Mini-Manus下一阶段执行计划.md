# Mini-Manus 下一阶段路线图（去掉评测优先级版）

## Summary
下一阶段目标从“先做评测框架”调整为：

1. **先扩能力层**：工具、skill、artifact 做强
2. **同时补稳定性**：缓存、错误模型、重试语义做实
3. **再补产品化**：导出、调试、回放、配置收口
4. **评测框架延后**：本阶段只保留最小运行指标，不建设正式 Evaluation Harness

默认原则：
- 保持 **单 Agent 主线**
- 不改现有核心数据模型
- 继续用 `socket.io` 做主实时通道
- 优先做“能明显提升任务能力和交付能力”的事情
- 正式评测体系放到后续阶段，不作为当前主目标

## 阶段一：能力层扩展 + 稳定性收口
这是下一阶段的主线，优先级最高。

### 1. Tool 扩展
按这个顺序扩，不并行开太多：

1. `download_file`
- 下载 PDF、图片、附件、原始素材
- 输出统一文件描述，写入 workspace

2. `extract_pdf_text`
- 读取 PDF 文本，供 research / writing skill 使用

3. `fetch_url_as_markdown`
- 对网页做更高保真的正文抽取
- 与 `browse_url` 区分：`browse_url` 偏快速摘要，`fetch_url_as_markdown` 偏正文保留

4. `export_pdf`
- 将 markdown / code / diagram 产物导出成文件型 artifact

5. `github_search`
- 技术调研、开源项目分析场景优先支持

工具统一约束：
- 全部使用 `zod` 定义输入
- 标明 `read-only / side-effect`
- read-only 工具统一走缓存路径
- 所有工具失败必须返回结构化错误类别 + 可读错误文本
- side-effect 工具必须保证幂等，或显式标记不可幂等

### 2. Skill 扩展
只加“明显高于单工具调用”的复合能力。

第一批固定做 4 个：

1. `competitive_analysis`
- 输入：两个产品/技术名
- 输出：对比报告 + 结论 + 结构化 JSON

2. `briefing_generation`
- 输入：主题
- 输出：会前 briefing / 调研 briefing

3. `artifact_review`
- 输入：artifact 或文件路径
- 输出：质量检查、缺失项、修订建议

4. `report_packaging`
- 输入：调研结果或中间文档
- 输出：主报告 + JSON 摘要 + 图表产物

skill 统一要求：
- 必须显式 `yield progress`
- 内部 tool 调用必须可观察
- side-effect skill 必须幂等
- 输入 schema 必须稳定，便于 planner 选用

### 3. Artifact 扩展
你现在已经支持 `markdown / json / file / code / diagram`，下一步重点是把它们变成**真正稳定的多产物链路**。

固定策略：
- 一个 run 允许产出多个 artifact
- finalizer 统一负责主产物收口
- skill / executor 可以补充中间或附加 artifact，但不能绕开 run 归档模型

第一阶段产物组合固定为：
1. `markdown + json`
2. `code + json`
3. `diagram + json`
4. `markdown/code/diagram + file(exported)`

JSON artifact 内容固定包含：
- `summary`
- `sources`
- `key_points`
- `artifact_type`
- `generated_at`

前端 artifact 区固定支持：
- Markdown 渲染
- Code 渲染
- Diagram 渲染
- JSON 渲染
- File 下载入口 / 描述展示

## 阶段二：稳定性、缓存与错误处理
这一阶段和能力扩展并行推进，但不单独起大项目。

### 1. 缓存统一化
你现在已经有 tool cache 和 LLM cache，下一步做“全链路统一”，不是另起系统。

固定要求：
- read-only tool 一律通过 registry 缓存执行
- skill 内部不允许直接绕过缓存路径
- `web_search`、`browse_url`、`fetch_url_as_markdown`、`extract_pdf_text` 统一支持 TTL
- side-effect 工具绝不缓存
- LLM cache 继续使用进程内缓存，但抽成配置项开关

本阶段不做：
- Redis
- 分布式缓存
- 跨实例共享缓存

### 2. 错误模型标准化
把现有字符串错误升级成结构化错误，但不改变主状态机语义。

统一错误类别：
- `timeout`
- `network`
- `tool_input_invalid`
- `tool_execution_failed`
- `llm_output_invalid`
- `artifact_generation_failed`
- `cancelled`
- `unknown`

要求：
- tool 返回错误时带 `errorCode`
- step_run 保留人类可读 `errorMessage`
- 运行事件里补结构化错误字段
- evaluator 规则前置判断优先基于错误类别，而不是只做字符串匹配

### 3. 重试与重规划收口
保持现有 `retry / replan / fail / continue / complete` 五分支，不改变语义，但补一致性。

固定要求：
- direct tool 失败时，传给 evaluator 的上下文必须包含错误文本，而不是空 output
- timeout 一律归类为可重试错误
- 空结果、错误结果、超时结果的规则前置检查继续保留
- side-effect skill 的 retry 前必须保证幂等语义明确
- 取消、失败、重试、重规划都要在前端实时体现原因

### 4. 最小运行指标
正式 Evaluation Harness 延后，但保留内建运行指标，方便调试和后续升级。

第一版只记录：
- `run_duration_ms`
- `retry_count`
- `replan_count`
- `step_count`
- `artifact_count`
- `tool_cache_hit_count`
- `tool_cache_miss_count`

要求：
- 这些指标只用于运行观测和调试视图
- 不单独建设评测 runner
- 不引入评分体系

## 阶段三：产品化与调试能力
能力层跑稳之后，开始补“像产品”的部分。

### 1. Run Debug 视图
在现有任务中心里增加调试能力，不重做页面结构。

固定展示内容：
- 当前 run 基础统计
- 重试次数 / 重规划次数
- 各 step 耗时
- 最后错误类别
- artifact 类型与数量
- cache hit/miss 情况

### 2. Replay / 回放能力
目标是“能回看过程”，不是做复杂播放器。

固定范围：
- 按事件顺序回看
- 显示 step started / progress / tool called / tool completed / step completed / step failed
- 基于已有事件和 step_run 数据重建视图
- 不做时间轴拖动播放

### 3. 配置收口
把可变参数抽成配置项。

统一抽配置：
- `MAX_RETRIES`
- `MAX_REPLANS`
- `MAX_STEPS`
- `STEP_TIMEOUT_MS`
- `TOOL_CACHE_TTL_MS`
- `LLM_CACHE_ENABLED`
- `EXPORT_PDF_ENABLED`

### 4. 导出与交付
artifact 区域补最小交付能力。

第一版只做：
- Markdown 下载
- JSON 下载
- Code 下载
- Diagram 源码下载
- 导出的 PDF 文件展示与下载

不做：
- 在线编辑器
- 文件管理器
- 外部文档平台同步

## 阶段四：后续延后项
这些不是当前阶段目标，统一往后放。

### 1. 正式 Evaluation Harness
延后到后续版本。
届时再做：
- 固定任务集
- 自动跑批
- success metrics
- 回归对比报告

### 2. 浏览器自动化
延后。
只有在 tool/skill/artifact 链成熟后再做。

### 3. 持久化缓存
延后。
当前只保留内存缓存。

### 4. 记忆 / 多 Agent
统一延后。
当前继续聚焦单 Agent。

## Test Plan
当前阶段不做正式评测框架，但必须完成这些功能验收。

### 核心任务验收
1. 调研任务
- 输入一个技术调研题目
- 产出 `markdown + json`
- 前端可预览
- step/tool/progress 可回看

2. 代码任务
- 输入代码生成任务
- 产出 `code artifact`
- 前端代码渲染正常
- metadata 中语言可识别

3. 图表任务
- 输入流程图/架构图任务
- 产出 `diagram artifact`
- Mermaid 渲染通过
- 渲染失败时回退源码展示

4. 文件导出任务
- markdown 产物能导出为文件
- 产出 `file artifact`
- 前端能看到并下载

### 稳定性验收
1. read-only tool 缓存生效
- 同输入重复调用命中缓存
- side-effect tool 不命中缓存

2. 错误链路
- timeout 能进入 retry
- 空结果可触发 retry/replan
- side-effect skill 失败后状态正确

3. 前端反馈
- 运行中可看到 progress
- tool 调用过程可见
- cancel / fail / retry / replan 有明确文案

## Assumptions
- 当前阶段不建设正式 Evaluation Harness。
- 当前阶段不做任务成功评分系统，只保留最小运行指标。
- 当前仍以单 Agent 为主，不引入多 Agent。
- 当前前端任务中心信息架构保持不变，只增强调试、导出和 artifact 展示能力。
- 当前缓存继续采用进程内实现，不引入 Redis 或持久化缓存。
