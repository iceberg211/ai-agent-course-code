/**
 * 03-planner-executor.mjs
 * =======================
 * 知识点：Planner / Executor 架构 —— 简易版 Manus 的核心模式
 *
 * 这是从"聊天 Agent"升级到"任务型 Agent"最关键的一步。
 *
 * 核心思维转变：
 *   ❌ 聊天模式：用户说一句话 → 模型回一句话 → 结束
 *   ✅ 任务模式：用户给一个任务 → 系统先规划 → 逐步执行 → 复盘 → 输出产物
 *
 * 状态中的核心对象：
 *   task       — 用户原始任务
 *   plan       — 计划步骤列表 (string[])
 *   currentStep — 当前执行到第几步
 *   stepResults — 每步的执行结果
 *   finalOutput — 最终输出
 *   status     — 任务当前状态
 *
 * 图结构：
 *   START → [planTask] → [executeStep] → [reviewStep]
 *                                ↑           ↓
 *                          (continue)   (next/replan/finish)
 *                                            ↓
 *                                      [replanTask] ↗
 *                                            ↓
 *                                         [END]
 */

import 'dotenv/config';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import chalk from 'chalk';

// ============================================================
// 工具（简化版 web_search 和 file_write）
// ============================================================
const webSearchTool = tool(
  async ({ query }) => {
    // 模拟搜索结果（真实项目中调用搜索 API）
    console.log(chalk.gray(`    🔍 搜索：${query}`));
    await new Promise(r => setTimeout(r, 300));
    return `搜索结果（模拟）：关于"${query}"，共找到 3 条相关信息：
1. 来源A：${query}相关内容摘要...
2. 来源B：更多${query}详情...  
3. 来源C：${query}最新数据...`;
  },
  {
    name: 'web_search',
    description: '搜索互联网上的信息',
    schema: z.object({ query: z.string().describe('搜索关键词') }),
  }
);

const fileWriteTool = tool(
  async ({ filename, content }) => {
    // 模拟文件写入（真实项目中用 fs.writeFile）
    console.log(chalk.gray(`    📝 写入文件：${filename}（${content.length} 字符）`));
    await new Promise(r => setTimeout(r, 100));
    return `文件 ${filename} 写入成功，共 ${content.length} 字符。`;
  },
  {
    name: 'file_write',
    description: '将内容写入文件',
    schema: z.object({
      filename: z.string().describe('文件名'),
      content: z.string().describe('文件内容'),
    }),
  }
);

const tools = [webSearchTool, fileWriteTool];
const toolsByName = Object.fromEntries(tools.map(t => [t.name, t]));

// ============================================================
// 模型
// ============================================================
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

const modelWithTools = model.bindTools(tools);

// ============================================================
// 状态定义（核心！）
// ============================================================
const TaskState = Annotation.Root({
  // 输入
  task: Annotation({ value: (_, r) => r, default: () => '' }),

  // 计划
  plan: Annotation({ value: (_, r) => r, default: () => [] }),
  planVersion: Annotation({ value: (_, r) => r, default: () => 0 }),

  // 执行进度
  currentStep: Annotation({ value: (_, r) => r, default: () => 0 }),
  stepResults: Annotation({
    value: (left, right) => [...left, ...right],  // 追加
    default: () => [],
  }),

  // 最终产物
  finalOutput: Annotation({ value: (_, r) => r, default: () => '' }),

  // 系统状态
  status: Annotation({ value: (_, r) => r, default: () => 'pending' }),
  errorMessage: Annotation({ value: (_, r) => r, default: () => '' }),
});

// ============================================================
// 节点一：规划任务
// ============================================================
const planTaskNode = async (state) => {
  console.log(chalk.cyan('\n  [Planner 节点] 正在分析任务，生成执行计划...'));

  const response = await model.invoke([
    new SystemMessage(`你是一个任务规划专家。
用户给你一个任务，你需要把它拆分成 2-4 个具体的可执行步骤。
每个步骤必须是：一个具体的动作（搜索/写文件/分析等），不是模糊的说法。

请以 JSON 数组格式返回，例如：
["步骤1：搜索XXX相关资料", "步骤2：分析搜索结果，提炼要点", "步骤3：撰写总结报告并保存"]

只返回 JSON 数组，不要其他内容。`),
    new HumanMessage(`请为以下任务制定执行计划：\n\n${state.task}`),
  ]);

  let plan;
  try {
    plan = JSON.parse(response.content);
  } catch {
    // 容错：如果解析失败，生成默认计划
    plan = [
      `搜索关于"${state.task}"的相关资料`,
      `整理搜索结果，提炼核心要点`,
      `撰写最终总结报告`,
    ];
  }

  console.log(chalk.yellow(`  → 生成计划（${plan.length} 个步骤）：`));
  plan.forEach((step, i) => console.log(chalk.gray(`     ${i + 1}. ${step}`)));

  return {
    plan,
    planVersion: state.planVersion + 1,
    currentStep: 0,
    status: 'running',
  };
};

// ============================================================
// 节点二：执行当前步骤
// ============================================================
const executeStepNode = async (state) => {
  const stepIndex = state.currentStep;
  const stepTitle = state.plan[stepIndex];

  console.log(chalk.cyan(`\n  [Executor 节点] 执行步骤 ${stepIndex + 1}/${state.plan.length}：${stepTitle}`));

  // 让模型决定用哪些工具来完成这个步骤
  const response = await modelWithTools.invoke([
    new SystemMessage(`你是一个任务执行助手。你的任务是完成指定的步骤。
可用工具：web_search（搜索信息），file_write（写入文件）。
完成步骤后，总结你做了什么，结果是什么。`),
    new HumanMessage(`主任务：${state.task}
    
当前步骤（${stepIndex + 1}/${state.plan.length}）：${stepTitle}

之前步骤的结果：
${state.stepResults.length > 0 ? state.stepResults.join('\n') : '（无）'}

请执行当前步骤。`),
  ]);

  // 如果模型选择了工具，执行工具
  let toolResult = '';
  if (response.tool_calls?.length > 0) {
    for (const toolCall of response.tool_calls) {
      const t = toolsByName[toolCall.name];
      if (t) {
        toolResult = await t.invoke(toolCall.args);
      }
    }
  }

  const stepSummary = `步骤${stepIndex + 1}（${stepTitle}）执行完成。${toolResult ? `工具结果：${toolResult.substring(0, 100)}...` : response.content}`;
  console.log(chalk.green(`  → 步骤完成：${stepSummary.substring(0, 80)}...`));

  return {
    stepResults: [stepSummary],
    status: 'reviewing',
  };
};

// ============================================================
// 节点三：复盘步骤结果，决定下一步
// ============================================================
const reviewStepNode = async (state) => {
  const nextStep = state.currentStep + 1;
  const isLastStep = nextStep >= state.plan.length;

  console.log(chalk.cyan(`\n  [Review 节点] 复盘步骤 ${state.currentStep + 1}，${isLastStep ? '这是最后一步' : `下一步是步骤 ${nextStep + 1}`}`));

  if (isLastStep) {
    // 所有步骤完成，生成最终输出
    const summaryResponse = await model.invoke([
      new SystemMessage('你是一个汇总助手，请根据所有步骤的执行结果，生成一份简洁的最终报告。'),
      new HumanMessage(`任务：${state.task}\n\n执行记录：\n${state.stepResults.join('\n')}\n\n请生成最终总结报告。`),
    ]);

    console.log(chalk.green('  → 所有步骤完成，生成最终报告'));
    return {
      currentStep: nextStep,
      finalOutput: summaryResponse.content,
      status: 'finished',
    };
  }

  // 还有更多步骤
  console.log(chalk.yellow(`  → 继续执行步骤 ${nextStep + 1}`));
  return {
    currentStep: nextStep,
    status: 'running',
  };
};

// ============================================================
// 条件边：根据 status 决定下一个节点
// ============================================================
const routeAfterReview = (state) => {
  switch (state.status) {
    case 'running':
      return 'executeStep';  // 继续执行下一步
    case 'finished':
      return END;            // 全部完成
    default:
      return END;
  }
};

// ============================================================
// 构建图
// ============================================================
const graph = new StateGraph(TaskState)
  .addNode('planTask', planTaskNode)
  .addNode('executeStep', executeStepNode)
  .addNode('reviewStep', reviewStepNode)
  // 边
  .addEdge(START, 'planTask')
  .addEdge('planTask', 'executeStep')
  .addEdge('executeStep', 'reviewStep')
  .addConditionalEdges('reviewStep', routeAfterReview, ['executeStep', END])
  .compile();

// ============================================================
// 运行
// ============================================================
console.log(chalk.bgBlue.white('\n=== 03-planner-executor.mjs ===\n'));

const task = '研究一下 LangGraph.js 的主要特点，整理成一份 500 字的技术笔记';
console.log(chalk.bgMagenta.white(`\n📋 用户任务：${task}\n`));

const finalState = await graph.invoke({ task });

console.log(chalk.bgGreen.black('\n✅ 任务完成！最终报告：\n'));
console.log(finalState.finalOutput);
console.log(chalk.gray(`\n📊 统计：执行了 ${finalState.plan.length} 个步骤，计划版本 v${finalState.planVersion}`));

/**
 * 理解要点：
 * 1. 任务系统的核心是 plan（计划）+ currentStep（进度）+ stepResults（历史）
 * 2. Planner 和 Executor 是两个独立节点，职责分离
 * 3. reviewStep 是决策节点——决定继续、重规划还是结束
 * 4. 这个结构就是 Manus 的骨架，后面只是在上面加工具和持久化
 */
