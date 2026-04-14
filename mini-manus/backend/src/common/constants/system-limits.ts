/**
 * 系统内容边界常量
 *
 * 设计原则：截断只在边界发生，每条边界有明确的语义原因，且只发生一次。
 *
 * 数据流：
 *   [工具原始输出]
 *     → TOOL_OUTPUT_MAX_LENGTH (tool.interface.ts, ≤ 20 000)   ← 工具层边界
 *     → [AgentState.stepResults]
 *     → DB_RESULT_SUMMARY_MAX (step_run.result_summary)         ← 存储层边界
 *     → PROMPT_HISTORY_STEP_MAX (LLM prompt 历史步骤)           ← 上下文层边界
 *
 * 修改任何值前请确认影响的边界层级和下游消费方。
 */

// ─── 存储层 ───────────────────────────────────────────────────────────────────

/**
 * step_run.result_summary 字段 / StepResult.toolOutput 的最大字符数。
 *
 * 语义：让 evaluator 和后续步骤读懂"这一步做了什么"，不需要完整工具输出。
 * 完整输出通过 persistStepOutput 落盘，供需要时通过 read_file 读取。
 *
 * 依据：2 000 chars ≈ 400 词，足够表达步骤结论和关键数据。
 *       工具层已保证原始输出 ≤ 20 000 chars；此处进一步裁剪用于 DB 摘要列。
 */
export const DB_RESULT_SUMMARY_MAX = 2_000;

// ─── LLM 上下文层 ─────────────────────────────────────────────────────────────

/**
 * buildRecentSummaries 中每条历史步骤的内容上限（单步，非总量）。
 *
 * 语义：在 3 000 字符的总预算内，历史步骤按"最近优先"填充。
 *       单步内容限制越小，能塞入的历史步骤越多，反之内容越丰富。
 *
 * 依据：总预算 3 000 chars；当前步骤占 60%（≈ 1 800）；
 *       剩余 1 200 chars 按 300 chars/步可容纳 ~4 条历史摘要，
 *       与"近 3-5 步足够评估"的经验吻合。
 */
export const PROMPT_HISTORY_STEP_MAX = 300;

/**
 * 重试 hint 进入 tool-calling prompt 的最大长度。
 *
 * 语义：传递上次失败的错误类型和关键信息，无需完整堆栈或原始输出。
 * 依据：500 chars 覆盖绝大多数错误消息；完整堆栈对"换一个 URL 重试"的参数决议无帮助。
 */
export const PROMPT_RETRY_HINT_MAX = 500;

// ─── 入口层（用户输入 → 系统）────────────────────────────────────────────────

/**
 * 用户直接提供的输入（task input / revision input）的最大长度。
 *
 * 语义：在 sanitizeInput 处截断，防止超长输入导致 token 爆炸或注入 prompt。
 * 依据：任务描述通常 < 500 chars；2 000 chars 为宽松上限，保留足够余量。
 * 注意：此边界针对"用户直接输入"，工具返回的外部内容通过 <untrusted_content> 隔离。
 */
export const USER_INPUT_MAX = 2_000;

/**
 * detectInjection 返回的命中片段最大长度（仅用于日志）。
 *
 * 语义：日志可读性截断，不是数据边界。
 * 依据：80 chars 足够展示注入模式的特征片段，不污染日志行。
 */
export const INJECTION_LOG_PREVIEW_MAX = 80;

// ─── 事件层（调试 / 观测用途）────────────────────────────────────────────────

/**
 * EVALUATOR_DECIDED 事件中 lastStepOutputPreview 字段的最大长度。
 *
 * 语义：前端调试面板展示的步骤输出预览，非 LLM 输入。
 *       完整数据已通过 DB_RESULT_SUMMARY_MAX 存入数据库。
 * 依据：300 chars 足够前端展示一行摘要；短小减少 WebSocket 负载。
 */
export const EVENT_STEP_PREVIEW_MAX = 300;

/**
 * 事件 payload 中 reason / errorMessage 字段的最大长度。
 *
 * 语义：人类可读的简短决策原因，完整 reason 已存入 step_run.error_message。
 * 依据：200 chars ≈ 40 词，足够传达决策摘要。
 */
export const EVENT_REASON_MAX = 200;
