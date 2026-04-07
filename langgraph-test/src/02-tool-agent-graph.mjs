/**
 * 02-tool-agent-graph.mjs
 * =======================
 * 知识点：用 StateGraph 实现 ReAct Agent（工具调用循环）
 *
 * 与你已有的 mini-cursor.mjs（while 循环）的对比：
 *
 * ❌ while 循环的问题：
 *   - 状态混在消息历史里，不清晰
 *   - 不能从中间暂停/恢复
 *   - 不能做条件分支（失败重试 vs 继续）
 *   - 不能加 checkpoint（服务重启就丢失）
 *
 * ✅ StateGraph 的优势：
 *   - 状态显式定义，每个字段含义清晰
 *   - 可以在任何节点之间加中断点
 *   - 条件分支用 addConditionalEdges，逻辑清晰
 *   - 可以接 MemorySaver 做持久化
 *
 * 图结构：
 *   START → [llmCall] → shouldContinue? → [toolNode] → [llmCall] → ...
 *                                       → END
 */

import 'dotenv/config';
import { StateGraph, Annotation, START, END, MessagesAnnotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { AIMessage, ToolMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import chalk from 'chalk';

// ============================================================
// 工具定义（和 mini-cursor.mjs 一样，可复用）
// ============================================================
const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // 简单的表达式计算（实际项目中用 mathjs 之类的库）
      const result = Function(`"use strict"; return (${expression})`)();
      return `计算结果：${expression} = ${result}`;
    } catch (e) {
      return `计算失败：${e.message}`;
    }
  },
  {
    name: 'calculator',
    description: '计算数学表达式，例如 (2 + 3) * 4',
    schema: z.object({
      expression: z.string().describe('数学表达式'),
    }),
  }
);

const getCurrentTimeTool = tool(
  async () => {
    return `当前时间：${new Date().toLocaleString('zh-CN')}`;
  },
  {
    name: 'get_current_time',
    description: '获取当前时间',
    schema: z.object({}),
  }
);

const tools = [calculatorTool, getCurrentTimeTool];
const toolsByName = Object.fromEntries(tools.map(t => [t.name, t]));

// ============================================================
// 模型
// ============================================================
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
}).bindTools(tools);

// ============================================================
// 状态定义
// ============================================================
// MessagesAnnotation 是 LangGraph 内置的消息状态，自动处理消息追加
// 等价于：messages: Annotation({ value: (left, right) => addMessages(left, right) })
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,  // 包含 messages 字段（自动追加）
  iterationCount: Annotation({  // 记录迭代次数，防止无限循环
    value: (left, right) => right,
    default: () => 0,
  }),
});

// ============================================================
// 节点定义
// ============================================================

// 节点1：调用 LLM
const llmCallNode = async (state) => {
  const count = state.iterationCount + 1;
  console.log(chalk.cyan(`\n  [LLM 节点] 第 ${count} 次调用模型...`));

  const response = await model.invoke([
    new SystemMessage('你是一个助手，有计算器和时间查询工具。需要时请使用工具。'),
    ...state.messages,
  ]);

  console.log(chalk.gray(`  → 模型回复：${response.content || '(触发工具调用)'}`));
  if (response.tool_calls?.length) {
    console.log(chalk.gray(`  → 工具调用：${response.tool_calls.map(tc => tc.name).join(', ')}`));
  }

  return {
    messages: [response],
    iterationCount: count,
  };
};

// 节点2：执行工具
const toolNode = async (state) => {
  const lastMessage = state.messages.at(-1);
  const results = [];

  for (const toolCall of lastMessage.tool_calls ?? []) {
    console.log(chalk.yellow(`\n  [工具节点] 执行工具：${toolCall.name}`));
    const foundTool = toolsByName[toolCall.name];
    
    if (foundTool) {
      const result = await foundTool.invoke(toolCall.args);
      console.log(chalk.gray(`  → 工具结果：${result}`));
      results.push(new ToolMessage({
        content: result,
        tool_call_id: toolCall.id,
      }));
    } else {
      results.push(new ToolMessage({
        content: `工具 ${toolCall.name} 不存在`,
        tool_call_id: toolCall.id,
      }));
    }
  }

  return { messages: results };
};

// ============================================================
// 条件边函数（决定下一步去哪个节点）
// ============================================================
const shouldContinue = (state) => {
  const lastMessage = state.messages.at(-1);

  // 超过最大迭代次数，强制结束
  if (state.iterationCount >= 10) {
    console.log(chalk.red('  [条件边] 达到最大迭代次数，强制结束'));
    return END;
  }

  // 如果最后一条是 AI 消息且有工具调用 → 去执行工具
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length > 0) {
    console.log(chalk.blue('  [条件边] → toolNode（需要执行工具）'));
    return 'toolNode';
  }

  // 否则 → 结束
  console.log(chalk.green('  [条件边] → END（任务完成）'));
  return END;
};

// ============================================================
// 构建图
// ============================================================
const graph = new StateGraph(AgentState)
  .addNode('llmCall', llmCallNode)
  .addNode('toolNode', toolNode)
  .addEdge(START, 'llmCall')
  // 条件边：llmCall 执行后，由 shouldContinue 决定去哪里
  .addConditionalEdges('llmCall', shouldContinue, ['toolNode', END])
  // 工具执行完后，永远回到 llmCall（让模型决定下一步）
  .addEdge('toolNode', 'llmCall')
  .compile();

// ============================================================
// 运行
// ============================================================
console.log(chalk.bgBlue.white('\n=== 02-tool-agent-graph.mjs ===\n'));

const queries = [
  '现在几点了？另外帮我算一下 (123 + 456) * 7 是多少？',
];

for (const query of queries) {
  console.log(chalk.bgMagenta.white(`\n📋 任务：${query}`));

  const result = await graph.invoke({
    messages: [new HumanMessage(query)],
  });

  const lastAI = result.messages.filter(m => m instanceof AIMessage).at(-1);
  console.log(chalk.bgGreen.black('\n✅ 最终回答：'));
  console.log(' ', lastAI?.content);
  console.log(chalk.gray(`  (共调用模型 ${result.iterationCount} 次)`));
}

/**
 * 理解要点：
 * 1. addConditionalEdges 是 LangGraph 最重要的 API，实现了"根据状态决定下一步"
 * 2. 工具节点和 LLM 节点的循环，是所有 ReAct Agent 的基础结构
 * 3. 在这个基础上，Manus 只是把"工具结果"替换成了"步骤执行结果"
 * 4. 加上 MemorySaver 之后，这个循环就可以暂停/恢复了
 */
