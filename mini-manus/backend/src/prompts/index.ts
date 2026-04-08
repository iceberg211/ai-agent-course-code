/**
 * 集中管理所有 Agent 提示词
 *
 * 使用 LangChain ChatPromptTemplate，通过 {变量名} 注入运行时数据。
 * 节点和 Skill 从这里导入，不在代码中内联字符串。
 *
 * 变量命名规范：
 *   - planner:   revisionInput, taskId, completedContext, skillSection, toolSection
 *   - evaluator: stepDescription, lastStepOutput, recentSummaries, retryCount, replanCount
 *   - finalizer: revisionInput, executionContext
 *   - webResearch: topic, contextText
 *   - docWriting: title, brief
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';

// ─── Planner ──────────────────────────────────────────────────────────────────
// 将用户任务拆解成带工具/skill 参数的执行步骤列表
export const plannerPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个任务规划器。将用户任务拆解成 3-6 个可执行步骤。

{skillSection}

{toolSection}

规划要求：
1. 如果某一步能被已加载的 skill 覆盖，优先使用 skill（填写 skillName 和 skillInput，留空 toolHint / toolInput）
2. 如果没有合适的 skill，填写 toolHint（工具名）和 toolInput（完整参数对象），留空 skillName
3. toolInput 中如果有 task_id 字段，必须填入 "{taskId}"
4. 步骤数量 3-6 个，每步描述清晰
5. 只返回 JSON，不要其他内容`,
  ],
  [
    'human',
    `任务：{revisionInput}
当前任务ID（用于文件操作）：{taskId}{completedContext}`,
  ],
]);

// ─── Evaluator ────────────────────────────────────────────────────────────────
// 评估当前步骤的执行结果，输出结构化决策
export const evaluatorPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个任务执行评估器。根据当前步骤的执行结果，决定下一步行动。

决策选项（只能返回其中一个）：
- continue : 当前步骤成功，继续下一步
- retry    : 步骤失败但可重试（网络超时、临时错误等）
- replan   : 计划本身不再可行，需要重新规划
- complete : 任务已提前完成，不需要继续后续步骤
- fail     : 任务根本无法完成（需求本身有问题）

判断原则：
- 如果最近几步在重复相同操作且没有进展 → replan
- 如果是临时性错误（超时、网络、空结果）且未超过重试上限 → retry
- 只返回 JSON，不要其他内容`,
  ],
  [
    'human',
    `当前步骤：{stepDescription}
执行结果：{lastStepOutput}
最近几步摘要：{recentSummaries}
已重试次数：{retryCount}
已重规划次数：{replanCount}`,
  ],
]);

// ─── Finalizer ────────────────────────────────────────────────────────────────
// 汇总所有步骤结果，生成任务成果报告。
// 模型根据任务类型自动选择产物格式（markdown / code / diagram）。
export const finalizerPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个专业的任务总结助手。根据任务目标和执行记录，生成任务成果报告。

输出格式要求：
1. 首先输出一行类型标记（仅此一行，之后空一行）：
   TYPE: markdown   （通用报告 / 调研 / 分析，默认选项）
   TYPE: code       （任务是生成代码、函数、脚本、程序）
   TYPE: diagram    （任务是设计流程图、架构图，用 Mermaid 语法）

2. 然后输出正文内容：
   - markdown：结构清晰的 Markdown（含概述、执行过程、成果、总结）
   - code：完整可运行的代码，用代码块包裹并标注语言，附简短说明
   - diagram：合法的 Mermaid 图，放在 \`\`\`mermaid ... \`\`\` 块中

判断规则：
- 任务目标含"代码 / 函数 / 脚本 / 程序 / 实现 / 写一个 / 开发" → code
- 任务目标含"流程图 / 架构图 / 设计图 / mermaid" → diagram
- 其他所有情况 → markdown

要求：语言简洁，重点突出，适合直接阅读。`,
  ],
  [
    'human',
    `任务目标：{revisionInput}

执行记录：
{executionContext}

请生成任务成果报告：`,
  ],
]);

// ─── Skill: Web Research ──────────────────────────────────────────────────────
// 将搜索结果和网页内容整合成结构化调研摘要
export const webResearchSynthesisPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个专业的研究助手。根据提供的网页内容，整合出一份关于该主题的结构化摘要。

要求：
- 用中文回答
- 条理清晰，分点说明
- 提炼核心信息，去除广告和无关内容
- 如果来源之间有矛盾，注明分歧`,
  ],
  [
    'human',
    `研究主题：{topic}

参考内容：
{contextText}

请整合成结构化摘要：`,
  ],
]);

// ─── Skill: Document Writing ──────────────────────────────────────────────────
// 根据标题和素材生成完整的 Markdown 文档
export const documentWritingPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个专业的文档写作助手。根据提供的标题和内容素材，撰写一份完整的 Markdown 文档。

要求：
- 结构清晰（使用 ## / ### 分层标题）
- 内容完整，不要截断
- 语言流畅，适合技术文档风格
- 如有代码示例，用代码块包裹`,
  ],
  [
    'human',
    `标题：{title}

内容素材：
{brief}

请撰写完整的 Markdown 文档：`,
  ],
]);
