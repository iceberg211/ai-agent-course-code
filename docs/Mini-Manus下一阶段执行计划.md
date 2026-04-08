# Mini-Manus 下一阶段执行计划（课程演示 / 双轨并行）

## Summary
目标是在当前 V1 可演示版本上，做一轮“能力扩展 + 稳定性底座”双轨收口，让系统从“能做调研并写报告”升级到“能做结构化研究、对比分析、多产物交付，并且有最小评测与缓存能力”。

执行顺序固定为 3 个里程碑：
1. 先补稳定性底座：错误模型、重试语义、工具缓存
2. 再扩高价值能力：3 个工具、3 个 Skill、3 类产物
3. 最后补评测与验收：Evaluation Harness、成功指标、课程 demo 基线

本轮默认定位：
- 服务目标：课程演示优先
- 架构保持：单 Agent、`socket.io`、PostgreSQL
- 明确不做：多 Agent、浏览器自动化、代码执行沙箱、Redis

## Key Changes

### 里程碑 1：稳定性底座
- 统一 `ToolResult` 返回契约：
  `success / output / error / errorCode / retryable / metadata`
- 统一错误分类：
  `timeout`、`network`、`validation`、`blocked`、`not_found`、`rate_limit`、`unknown`
- 修正 direct tool 失败语义：
  tool 失败时，`lastStepOutput` 传标准化错误文本，不再只传空 `output`
- 保留当前宏观重试机制，但补“微重试”到只读外部工具：
  `web_search`、`browse_url`、`download_file`
- 微重试策略固定：
  最多 2 次，指数退避 `500ms -> 1500ms`，仅在 `retryable=true` 时触发
- 增加服务端工具缓存，使用 PostgreSQL，不新增 Redis：
  表结构为通用 `cache_entries`
  字段至少包括 `namespace`、`keyHash`、`value`、`expiresAt`、`createdAt`
- 缓存范围固定：
  `web_search` TTL 30 分钟
  `browse_url` TTL 24 小时
  `download_file` TTL 24 小时
- 本阶段不缓存 `evaluator`
- `planner` 和 `finalizer` 暂不缓存，避免先把错误行为固化

### 里程碑 2：能力扩展
- 新增 3 个工具：
  1. `download_file`
  输入：`{ task_id, url, target_path? }`
  输出：下载结果字符串；`metadata` 写入 `path / mimeType / size`
  2. `read_pdf`
  输入：`{ task_id, path, max_pages? }`
  输出：提取后的文本内容
  3. `extract_structured_data`
  输入：`{ content, schema_description }`
  输出：合法 JSON 字符串；失败时返回结构化错误
- 工具边界固定：
  `download_file` 只允许 `http/https`
  单文件大小限制 `20MB`
  `read_pdf` 只读取工作区内文件
  所有文件型工具继续走现有 workspace 安全路径校验
- 新增 3 个 Skill：
  1. `source_briefing`
  输入主题，产出“来源列表 + 要点摘要”
  2. `competitive_analysis`
  输入两个或三个对象，产出“对比表 + 结论”
  3. `artifact_packaging`
  输入已有摘要/结构化数据，产出多种 artifact 并写入 workspace
- planner 策略固定：
  优先 `web_research`、`source_briefing`、`competitive_analysis`、`document_writing`、`artifact_packaging`
  只有这些 Skill 不适用时才落到 direct tool
- 产物扩展固定为 3 类正式交付：
  1. `markdown`：最终主报告
  2. `json`：结构化结果，如 sources、key findings、comparison table
  3. `file`：导出的工作区文件
- `file` artifact 约定：
  `content` 存展示说明
  `metadata.path` 存工作区相对路径
  `metadata.mimeType` 存 MIME
- `finalizer` 行为改为：
  默认至少生成一个 `markdown` artifact
  若本轮任务包含结构化输出，则额外生成 `json` artifact
  若调用了 `artifact_packaging`，则额外生成 `file` artifact
- 前端 artifact 区增强：
  `markdown` 继续预览
  `json` 继续格式化预览
  `file` 增加下载按钮与元数据展示
- 新增一个后端下载接口：
  `GET /tasks/:taskId/artifacts/:artifactId/file`
  仅允许下载 `type=file` 的 artifact 对应工作区文件

### 里程碑 3：评测与课程验收
- 新增 `evals` 目录，放任务样本与结果
- 任务样本固定 12 条：
  4 条调研摘要
  4 条竞品/技术对比
  2 条文件/PDF 场景
  1 条失败场景
  1 条取消场景
- 增加评测运行器：
  `npm run eval`
  自动创建任务、轮询 run 终态、拉取 artifact、输出结果 JSON
- 评测结果文件固定输出到：
  `mini-manus/evals/results/<timestamp>.json`
- 本轮 success metrics 固定为：
  `run_completion_rate`
  `artifact_markdown_rate`
  `artifact_json_valid_rate`
  `file_artifact_rate`
  `avg_runtime_sec`
  `avg_retry_count`
  `median_source_count`
  `failure_reason_distribution`
- 课程 demo 验收阈值固定：
  核心评测集完成率 `>= 85%`
  3 条精选演示任务连续 2 次全成功
  `json` artifact 合法率 `>= 95%`
  `cancel` 场景成功率 `100%`
- 本轮不引入 LLM-as-a-judge
- 内容质量采用：
  自动指标 + 3 条演示任务人工 spot check

## Public Interfaces / Type Changes
- 后端 `ToolResult` 增加：
  `errorCode?: string`
  `retryable?: boolean`
  `metadata?: Record<string, unknown>`
- 后端新增缓存实体 `cache_entries`
- 后端新增下载接口：
  `GET /tasks/:taskId/artifacts/:artifactId/file`
- `Artifact.metadata` 约定扩展为：
  `path?: string`
  `mimeType?: string`
  `size?: number`
- 评测任务样本格式固定为：
  `id / input / expectedArtifacts / mustComplete / mustContainKeywords? / minSourceCount? / allowCancel?`

## Test Plan
- 单元测试
  - 3 个新工具的 schema、失败分支、边界限制
  - 3 个新 Skill 的输入输出和 progress 事件
  - `ToolResult` 标准化错误分类
  - 缓存命中 / 过期 / miss
- 集成测试
  - `create -> plan -> run -> multi-artifact complete`
  - `retry` 后同 revision 新 run
  - `replan` 后多版 plan 仍能正确回看
  - `cancel` 后 run 进入 `cancelled`
  - `file artifact` 下载成功
  - `web_search / browse_url` cache hit 时不重复外呼
- 前端验收
  - `markdown/json/file` 三类 artifact 都能正确展示
  - `file` artifact 有下载入口
  - 长任务运行时仍保留现在的 live feedback
  - 历史 revision/run 切换后 artifact 视图正确
- 评测验收
  - `npm run eval` 可批量执行 12 条任务
  - 结果 JSON 可计算全部指标
  - 精选 3 条课程 demo 任务满足阈值

## Assumptions
- 本轮继续使用 PostgreSQL 作为唯一后端存储，缓存也落 PostgreSQL
- 不引入 Redis、消息队列、浏览器自动化、代码执行沙箱
- 当前 `socket.io` 实时反馈保留，不新增 SSE 主链路
- `document_writing` 继续保持幂等覆盖写，所有 side-effect Skill 都遵守同一原则
- 这轮优先把“调研 / 对比 / 结构化输出 / 多产物交付”做深，不扩到通用外部系统操作
