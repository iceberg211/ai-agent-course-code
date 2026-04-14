/**
 * ReAct SubAgent 基础设施
 *
 * 成熟社区方案：使用 @langchain/langgraph/prebuilt 的 createReactAgent，
 * 替代"把 workflow 包装成 Skill"的反模式。
 *
 * 架构原则：
 * - researcher SubAgent：只有读权限工具（search + fetch），Evaluator 可见中间结果
 * - writer SubAgent：只有写权限工具（write_file + export_pdf），task_id 自动注入
 * - SubAgent 是无状态的（Stateless）：每次调用独立运行，complete instructions in one call
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { BaseMessage } from '@langchain/core/messages';
import { ToolRegistry } from '@/tool/tool.registry';

// ─── SubAgent 定义 ────────────────────────────────────────────────────────────

interface SubAgentDef {
  /** 可使用的工具名列表（不在 registry 的工具自动跳过）*/
  tools: string[];
  /** 需要自动注入的参数（对应工具的 schema 中会隐藏这些字段）*/
  injectArgs?: (taskId: string) => Record<string, unknown>;
  /** System prompt */
  systemPrompt: string;
}

const SUBAGENT_DEFS: Record<'researcher' | 'writer', SubAgentDef> = {
  researcher: {
    tools: ['think', 'web_search', 'fetch_url_as_markdown', 'browse_url'],
    // researcher 只使用读工具，无需注入 task_id
    systemPrompt: `你是一个专业的深度调研 Agent。

**工作职责**：根据用户指定的调研主题，使用搜索和浏览工具系统收集高质量信息，最终输出结构清晰的调研报告。

**工作流程**：
1. 分析调研主题，识别核心问题和关键词
2. 使用 web_search 从多个角度搜索信息（至少 2-3 次不同关键词）
3. 使用 fetch_url_as_markdown 阅读最相关的来源页面（选 2-4 个高质量来源）
4. 使用 think 整理发现、识别模式、补充分析
5. 最终输出完整调研报告

**输出要求**：调研报告必须包含 核心发现、数据支撑、关键来源（URL 列表）、结论与建议。格式清晰、内容翔实。`,
  },

  writer: {
    tools: ['think', 'read_file', 'list_directory', 'write_file', 'export_pdf'],
    injectArgs: (taskId) => ({ task_id: taskId }),
    systemPrompt: `你是一个专业的文档撰写 Agent。

**工作职责**：根据提供的材料和写作目标，撰写高质量的正式文档并保存为文件。

**工作流程**：
1. 仔细阅读材料和目标要求
2. 使用 think 规划文档结构（目录、章节、重点）
3. 撰写完整的 Markdown 报告内容
4. 使用 write_file 将报告保存（路径示例：task-report.md）
5. 如可用，使用 export_pdf 导出 PDF 版本（路径：task-report.pdf）

**输出要求**：报告结构清晰（有目录/章节）、内容完整、有数据支撑、有结论建议。Markdown 格式。`,
  },
};

// ─── SubAgent 执行器 ──────────────────────────────────────────────────────────

/**
 * 运行 SubAgent（ReAct 模式）。
 *
 * 使用 createReactAgent 构建独立的 ReAct 子图，SubAgent 自主决定工具调用顺序，
 * 完成后返回最终文本输出。
 *
 * SubAgent 是无状态的：每次调用创建全新 agent 实例（compile({ checkpointer: false })）
 * ——这是 subgraph-as-node 的标准模式，避免 checkpoint 命名空间冲突。
 *
 * @param subAgentName  SubAgent 类型（'researcher' | 'writer'）
 * @param objective     任务目标（已解析 __STEP_RESULTS__ 占位符）
 * @param taskId        当前任务 ID，注入 side-effect 工具
 * @param llm           共享 LLM 实例
 * @param toolRegistry  工具注册表
 * @param signal        取消信号
 * @returns             SubAgent 最终输出文本
 */
export async function runSubAgent(
  subAgentName: string,
  objective: string,
  taskId: string,
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  signal: AbortSignal,
): Promise<string> {
  const def = SUBAGENT_DEFS[subAgentName as 'researcher' | 'writer'];
  if (!def) throw new Error(`Unknown SubAgent: ${subAgentName}`);
  const injected = def.injectArgs ? def.injectArgs(taskId) : {};

  // 只加载 registry 中已注册的工具（可选工具如 browse_url 不强制要求）
  const tools = def.tools
    .filter((name) => toolRegistry.has(name))
    .map((name) => toolRegistry.getAsLangChainTool(name, injected));

  // createReactAgent 是 @langchain/langgraph/prebuilt 的标准 ReAct Agent 工厂。
  // checkpointer 默认 false（子图模式，无需 interrupt 或跨调用记忆）。
  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: def.systemPrompt,
  });

  const result = await agent.invoke(
    { messages: [new HumanMessage(objective)] },
    { signal },
  );

  // 从最后一条 AI 消息提取文本输出
  const messages = result.messages;
  const lastMsg = messages[messages.length - 1];
  const content = lastMsg?.content;

  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === 'string'
          ? c
          : ((c as { text?: string; type?: string }).text ?? ''),
      )
      .join('');
  }
  return JSON.stringify(content ?? '');
}
