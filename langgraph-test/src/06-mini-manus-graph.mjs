/**
 * 06-mini-manus-graph.mjs
 * =======================
 * 知识点：综合实战 —— 简易版 Manus 核心执行引擎
 *
 * 这是把前 5 个示例综合起来的完整版本。
 * 这个文件可以直接作为简易版 Manus 后端的 Agent 执行核心。
 *
 * 完整节点链：
 *   START
 *     → [receiveTask]     接收任务，初始化状态
 *     → [planTask]        规划步骤（Planner）
 *     → [humanReview]     等待用户确认计划（可选）
 *     → [executeStep]     执行当前步骤（Executor）
 *     → [reviewStep]      复盘该步骤
 *     ↕  (循环或重规划)
 *     → [finishTask]      汇总产物，结束
 *     → END
 *
 * 流式事件：
 *   每个节点执行时，通过 streamEvents 推送事件
 *   前端消费这些事件，实时显示任务进度
 */

import 'dotenv/config';
import { StateGraph, Annotation, START, END, interrupt, Command, MessagesAnnotation } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import chalk from 'chalk';

// ============================================================
// 工具集（简易版 Manus 第一版工具）
// ============================================================
const webSearchTool = tool(
  async ({ query }) => {
    console.log(chalk.gray(`      🔍 [web_search] 搜索：${query}`));
    await new Promise(r => setTimeout(r, 400));
    return JSON.stringify({
      results: [
        { title: `${query}相关文章`, url: 'https://example.com/1', summary: `关于${query}的详细介绍...` },
        { title: `${query}最佳实践`, url: 'https://example.com/2', summary: `${query}的使用建议...` },
      ]
    });
  },
  {
    name: 'web_search',
    description: '搜索互联网上的最新信息',
    schema: z.object({ query: z.string().describe('搜索关键词') }),
  }
);

const fileWriteTool = tool(
  async ({ path, content }) => {
    console.log(chalk.gray(`      📝 [file_write] 写入：${path}（${content.length}字符）`));
    await new Promise(r => setTimeout(r, 200));
    return `文件 ${path} 已成功写入，共 ${content.length} 字符。`;
  },
  {
    name: 'file_write',
    description: '将内容写入文件（Markdown、JSON、TXT等）',
    schema: z.object({
      path: z.string().describe('文件路径，如 ./output/report.md'),
      content: z.string().describe('文件内容'),
    }),
  }
);

const browserExtractTool = tool(
  async ({ url }) => {
    console.log(chalk.gray(`      🌐 [browser_extract] 访问：${url}`));
    await new Promise(r => setTimeout(r, 600));
    return `页面内容（模拟）：访问 ${url} 成功，提取到以下内容：标题、正文摘要、关键数据...`;
  },
  {
    name: 'browser_extract',
    description: '访问网页并提取页面内容',
    schema: z.object({ url: z.string().describe('要访问的 URL') }),
  }
);

const tools = [webSearchTool, fileWriteTool, browserExtractTool];
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
// Manus 状态定义
// ============================================================
const ManusState = Annotation.Root({
  // 任务基础信息
  taskId: Annotation({ value: (_, r) => r, default: () => '' }),
  userInput: Annotation({ value: (_, r) => r, default: () => '' }),

  // 计划层
  plan: Annotation({ value: (_, r) => r, default: () => [] }),
  planVersion: Annotation({ value: (_, r) => r, default: () => 0 }),

  // 执行层
  currentStepIndex: Annotation({ value: (_, r) => r, default: () => 0 }),
  stepResults: Annotation({
    value: (left, right) => [...left, ...right],
    default: () => [],
  }),
  replanCount: Annotation({ value: (_, r) => r, default: () => 0 }),

  // 产物层
  artifacts: Annotation({
    value: (left, right) => [...left, ...right],
    default: () => [],
  }),

  // 状态机
  // pending → planning → reviewing_plan → running → (replan) → finishing → succeeded/failed
  status: Annotation({ value: (_, r) => r, default: () => 'pending' }),
  errorMessage: Annotation({ value: (_, r) => r, default: () => '' }),

  // 最终输出
  finalSummary: Annotation({ value: (_, r) => r, default: () => '' }),
});

// ============================================================
// 节点1：接收任务
// ============================================================
const receiveTaskNode = async (state) => {
  console.log(chalk.bgCyan.black('\n  📥 [接收任务]'));
  console.log(`  用户任务：${state.userInput}`);
  return { status: 'planning' };
};

// ============================================================
// 节点2：规划任务（Planner）
// ============================================================
const planTaskNode = async (state) => {
  console.log(chalk.bgYellow.black(`\n  🗂️  [规划任务] v${state.planVersion + 1}`));

  const isReplanning = state.planVersion > 0;
  const prompt = isReplanning
    ? `之前的计划执行到第${state.currentStepIndex}步出现问题，请重新规划。
       原计划：${JSON.stringify(state.plan)}
       已有结果：${state.stepResults.join(' | ')}`
    : `请为以下任务制定 2-4 个具体执行步骤：\n${state.userInput}`;

  const response = await model.invoke([
    new SystemMessage(`你是任务规划专家。把任务拆分成 2-4 个简洁清晰的步骤。
可用工具：web_search（搜索信息）, browser_extract（访问网页）, file_write（写文件）。
每个步骤说明会用到什么工具。
仅返回 JSON 数组，格式：["步骤1：用web_search搜索...", "步骤2：用file_write写入..."]`),
    new HumanMessage(prompt),
  ]);

  let plan;
  try {
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    plan = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
  } catch {
    plan = [
      `搜索"${state.userInput}"相关资料`,
      `整理资料并生成报告`,
      `将报告写入文件`,
    ];
  }

  console.log(chalk.yellow(`  → 计划（${plan.length}步）：`));
  plan.forEach((s, i) => console.log(chalk.gray(`     ${i + 1}. ${s}`)));

  return {
    plan,
    planVersion: state.planVersion + 1,
    currentStepIndex: 0,
    status: 'running',
  };
};

// ============================================================
// 节点3：执行当前步骤（Executor）
// ============================================================
const executeStepNode = async (state) => {
  const i = state.currentStepIndex;
  const stepTitle = state.plan[i];

  console.log(chalk.bgGreen.black(`\n  ⚡ [执行步骤 ${i + 1}/${state.plan.length}]`));
  console.log(`  ${stepTitle}`);

  // 调用模型决定用哪个工具
  const response = await modelWithTools.invoke([
    new SystemMessage(`你是执行助手。根据给定步骤和可用工具，完成步骤任务。
完成后简洁总结执行了什么、结果是什么。`),
    new HumanMessage(`主任务：${state.userInput}
当前步骤（${i + 1}/${state.plan.length}）：${stepTitle}
之前结果：${state.stepResults.slice(-2).join('\n') || '（无）'}
请执行当前步骤。`),
  ]);

  let toolResults = [];

  // 执行工具调用
  if (response.tool_calls?.length > 0) {
    for (const tc of response.tool_calls) {
      const t = toolsByName[tc.name];
      if (t) {
        const result = await t.invoke(tc.args);
        toolResults.push(`[${tc.name}] ${result}`);
      }
    }
  }

  const stepSummary = toolResults.length > 0
    ? `步骤${i + 1}完成：${toolResults.join('；')}`
    : `步骤${i + 1}完成：${response.content?.substring(0, 150) ?? '已完成'}`;

  console.log(chalk.green(`  → ${stepSummary.substring(0, 100)}...`));

  return {
    stepResults: [stepSummary],
    status: 'reviewing',
  };
};

// ============================================================
// 节点4：复盘步骤，决定下一步
// ============================================================
const reviewStepNode = async (state) => {
  const nextIndex = state.currentStepIndex + 1;
  const isDone = nextIndex >= state.plan.length;

  console.log(chalk.bgMagenta.white(`\n  🔍 [复盘步骤 ${state.currentStepIndex + 1}]`));
  console.log(`  ${isDone ? '✅ 所有步骤完成' : `→ 继续步骤 ${nextIndex + 1}`}`);

  if (isDone) {
    return { currentStepIndex: nextIndex, status: 'finishing' };
  }

  return { currentStepIndex: nextIndex, status: 'running' };
};

// ============================================================
// 节点5：完成任务，生成最终产物
// ============================================================
const finishTaskNode = async (state) => {
  console.log(chalk.bgBlue.white('\n  🏁 [完成任务] 生成最终总结报告...'));

  const summaryResponse = await model.invoke([
    new SystemMessage('你是报告助手，根据执行记录生成简洁的最终报告。'),
    new HumanMessage(`
任务：${state.userInput}
执行计划（v${state.planVersion}）：${state.plan.join('；')}
执行记录：
${state.stepResults.join('\n')}

请生成一份简洁的最终报告（200字以内）。`),
  ]);

  const summary = summaryResponse.content;
  console.log(chalk.blue('\n  最终报告：\n  ' + summary.substring(0, 200)));

  return {
    finalSummary: summary,
    artifacts: [{ type: 'summary', content: summary }],
    status: 'succeeded',
  };
};

// ============================================================
// 路由函数
// ============================================================
const routeAfterReview = (state) => {
  if (state.status === 'running') return 'executeStep';
  if (state.status === 'finishing') return 'finishTask';
  return END;
};

// ============================================================
// 构建图
// ============================================================
const checkpointer = new MemorySaver();

const manusGraph = new StateGraph(ManusState)
  .addNode('receiveTask', receiveTaskNode)
  .addNode('planTask', planTaskNode)
  .addNode('executeStep', executeStepNode)
  .addNode('reviewStep', reviewStepNode)
  .addNode('finishTask', finishTaskNode)
  // 边
  .addEdge(START, 'receiveTask')
  .addEdge('receiveTask', 'planTask')
  .addEdge('planTask', 'executeStep')
  .addEdge('executeStep', 'reviewStep')
  .addConditionalEdges('reviewStep', routeAfterReview, ['executeStep', 'finishTask', END])
  .addEdge('finishTask', END)
  .compile({ checkpointer });

// ============================================================
// 运行 —— 普通模式（invoke）
// ============================================================
console.log(chalk.bgBlue.white('\n=== 06-mini-manus-graph.mjs ==='));
console.log(chalk.bgBlue.white('=== 简易版 Manus 核心执行引擎 ===\n'));

const task = '帮我研究 Playwright 自动化测试的核心功能，输出一份技术总结';
const taskId = `task-${Date.now()}`;

console.log(chalk.bgMagenta.white(`\n📋 用户任务：${task}`));
console.log(chalk.gray(`   任务ID：${taskId}\n`));

// ============================================================
// 流式运行（实际 Manus 应该用这个模式，推送事件给前端）
// ============================================================
console.log(chalk.bgYellow.black('【流式模式】实时推送事件（Manus 的实际工作方式）\n'));

const config = { configurable: { thread_id: taskId } };

// streamEvents 会在每个节点执行时推送事件
// 这就是 Manus 前端实时更新的数据来源
for await (const event of manusGraph.streamEvents(
  { userInput: task, taskId },
  { ...config, version: 'v2' }
)) {
  // 只关注我们自己定义的节点事件
  if (event.event === 'on_chain_start' && event.name in { receiveTask: 1, planTask: 1, executeStep: 1, reviewStep: 1, finishTask: 1 }) {
    console.log(chalk.blue(`  📡 事件推送 → node_start: ${event.name}`));
  }
  if (event.event === 'on_chain_end' && event.name in { receiveTask: 1, planTask: 1, executeStep: 1, reviewStep: 1, finishTask: 1 }) {
    console.log(chalk.green(`  📡 事件推送 → node_end: ${event.name}`));
  }
}

// 获取最终状态
const finalState = await manusGraph.getState(config);
console.log(chalk.bgGreen.black('\n\n✅ 任务执行完成！'));
console.log(chalk.gray(`  状态：${finalState.values.status}`));
console.log(chalk.gray(`  步骤数：${finalState.values.plan?.length ?? 0}`));
console.log(chalk.gray(`  产物数：${finalState.values.artifacts?.length ?? 0}`));
console.log('\n📄 最终报告：\n');
console.log(finalState.values.finalSummary);

/**
 * 🎯 总结：这个文件就是简易版 Manus 的核心引擎
 *
 * 接下来要做的事情（正式项目）：
 * 1. 把 MemorySaver 替换成 PostgresSaver（状态落库）
 * 2. 把工具替换成真实的 Playwright + 搜索 API
 * 3. 在 Nest.js 中封装这个图，暴露 SSE 端点
 * 4. 把 streamEvents 的事件通过 SSE 推送给前端
 * 5. 前端根据事件类型更新任务界面
 */
