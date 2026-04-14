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
 *
 * 内置 SubAgent 定义（RESEARCHER_DEF / WRITER_DEF）在此导出，
 * 由 AgentModule.onModuleInit 注册到 SubAgentRegistry。
 * 其他模块可向 SubAgentRegistry 注册自定义 SubAgent，无需修改此文件。
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { Serialized } from '@langchain/core/load/serializable';
import { ToolRegistry } from '@/tool/tool.registry';
import {
  SubAgentDef,
  SubAgentRegistry,
} from '@/agent/subagents/subagent.registry';
import type { EventPublisher } from '@/event/event.publisher';
import { TASK_EVENTS } from '@/common/events/task.events';

// ─── 内置 SubAgent 定义（由 AgentModule 注册到 SubAgentRegistry）────────────

export const RESEARCHER_DEF: SubAgentDef = {
  tools: ['think', 'web_search', 'fetch_url_as_markdown', 'browse_url'],
  // researcher 只使用读工具，无需注入 task_id
  isSideEffect: false,
  systemPrompt: `你是一个专业的深度调研 Agent。

**工作职责**：根据用户指定的调研主题，使用搜索和浏览工具系统收集高质量信息，最终输出结构清晰的调研报告。

**工作流程**：
1. 分析调研主题，识别核心问题和关键词
2. 使用 web_search 从多个角度搜索信息（至少 2-3 次不同关键词）
3. 使用 fetch_url_as_markdown 阅读最相关的来源页面（选 2-4 个高质量来源）
4. 使用 think 整理发现、识别模式、补充分析
5. 最终输出完整调研报告

**输出要求**：调研报告必须包含 核心发现、数据支撑、关键来源（URL 列表）、结论与建议。格式清晰、内容翔实。`,
};

export const WRITER_DEF: SubAgentDef = {
  tools: ['think', 'read_file', 'list_directory', 'write_file', 'export_pdf'],
  injectArgs: (taskId) => ({ task_id: taskId }),
  isSideEffect: true, // write_file / export_pdf 有写操作
  systemPrompt: `你是一个专业的文档撰写 Agent。

**工作职责**：根据提供的材料和写作目标，撰写高质量的正式文档并保存为文件。

**工作流程**：
1. 仔细阅读材料和目标要求
2. 使用 think 规划文档结构（目录、章节、重点）
3. 撰写完整的 Markdown 报告内容
4. 使用 write_file 将报告保存（路径示例：task-report.md）
5. 如可用，使用 export_pdf 导出 PDF 版本（路径：task-report.pdf）

**输出要求**：报告结构清晰（有目录/章节）、内容完整、有数据支撑、有结论建议。Markdown 格式。`,
};

// ─── SubAgent 执行器 ──────────────────────────────────────────────────────────

/**
 * LangChain Callback：把 SubAgent 内部的工具调用/结果转发给主图的 EventPublisher。
 * 解决 createReactAgent 黑盒问题：前端/日志可以看到 SubAgent 调用了哪些工具。
 */
class SubAgentEventBridge extends BaseCallbackHandler {
  name = 'SubAgentEventBridge';

  /** runId → toolName，handleToolStart 写入，handleToolEnd 读取 */
  private readonly toolNames = new Map<string, string>();

  constructor(
    private readonly publisher: EventPublisher,
    private readonly taskId: string,
    private readonly runId: string,
    private readonly stepRunId: string,
  ) {
    super();
  }

  override handleToolStart(
    _tool: Serialized,
    input: string,
    toolRunId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ) {
    const toolName = runName ?? 'unknown_tool';
    this.toolNames.set(toolRunId, toolName);
    let toolInput: Record<string, unknown>;
    try {
      toolInput = JSON.parse(input) as Record<string, unknown>;
    } catch {
      toolInput = { raw: input };
    }
    this.publisher.emit(TASK_EVENTS.TOOL_CALLED, {
      taskId: this.taskId,
      runId: this.runId,
      stepRunId: this.stepRunId,
      toolName,
      toolInput,
    });
  }

  override handleToolEnd(
    output: string,
    toolRunId: string,
    _parentRunId?: string,
    _tags?: string[],
  ) {
    const toolName = this.toolNames.get(toolRunId) ?? 'unknown_tool';
    this.toolNames.delete(toolRunId);
    // output 已经经过 ToolRegistry.executeWithCache → truncateToolOutput 截断（≤ 20000 字符），
    // 此处不再二次截断，与主工具路径的 TOOL_COMPLETED 事件行为保持一致。
    const toolOutput =
      typeof output === 'string' ? output : JSON.stringify(output);
    this.publisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
      taskId: this.taskId,
      runId: this.runId,
      stepRunId: this.stepRunId,
      toolName,
      toolOutput,
      cached: false,
      error: null,
      errorCode: null,
    });
  }
}

/**
 * 运行 SubAgent（ReAct 模式）。
 *
 * 使用 createReactAgent 构建独立的 ReAct 子图，SubAgent 自主决定工具调用顺序，
 * 完成后返回最终文本输出。
 *
 * SubAgent 是无状态的：每次调用创建全新 agent 实例（compile({ checkpointer: false })）
 * ——这是 subgraph-as-node 的标准模式，避免 checkpoint 命名空间冲突。
 *
 * @param subAgentName     SubAgent 名称（在 SubAgentRegistry 中查找）
 * @param objective        任务目标（已解析 __STEP_RESULTS__ 占位符）
 * @param taskId           当前任务 ID，注入 side-effect 工具
 * @param runId            当前 run ID，用于事件发布
 * @param stepRunId        当前步骤 run ID，用于事件发布
 * @param llm              共享 LLM 实例
 * @param toolRegistry     工具注册表
 * @param subAgentRegistry SubAgent 注册表
 * @param eventPublisher   事件发布器，SubAgent 内部工具调用通过此转发给主图
 * @param signal           取消信号
 * @returns                SubAgent 最终输出文本
 */
export async function runSubAgent(
  subAgentName: string,
  objective: string,
  taskId: string,
  runId: string,
  stepRunId: string,
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  subAgentRegistry: SubAgentRegistry,
  eventPublisher: EventPublisher,
  signal: AbortSignal,
): Promise<string> {
  const def = subAgentRegistry.get(subAgentName);
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

  const eventBridge = new SubAgentEventBridge(
    eventPublisher,
    taskId,
    runId,
    stepRunId,
  );
  const result = await agent.invoke(
    { messages: [new HumanMessage(objective)] },
    { signal, callbacks: [eventBridge] },
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
