/**
 * 03-browser-agent.mjs
 * ====================
 * 知识点：浏览器 Agent —— 用 LLM 驱动浏览器自主完成任务
 *
 * 这是把 02-browser-tools.mjs（工具）和 02-tool-agent-graph.mjs（图）组合起来
 *
 * 核心挑战：
 * 1. 如何防止 Agent 无限循环（最大步数限制）
 * 2. 如何让 Agent 知道"任务完成了"（终止判断）
 * 3. 如何处理工具失败（错误恢复）
 *
 * 图结构：
 *   START → [agent] → shouldContinue? → [browserAction] → [agent] → ...
 *                                                        → END
 */

import 'dotenv/config';
import { StateGraph, Annotation, START, END, MessagesAnnotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { chromium } from 'playwright';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';

await fs.mkdir('./output', { recursive: true });

// ============================================================
// 浏览器单例
// ============================================================
let browser = null;
let page = null;

const getPage = async () => {
  if (!browser) browser = await chromium.launch({ headless: true });
  if (!page || page.isClosed()) {
    page = await browser.newPage();
  }
  return page;
};

// ============================================================
// 浏览器工具集（重用 02 的设计思路）
// ============================================================
const makeBrowserResult = (data) => JSON.stringify(data);

const navigateTool = tool(
  async ({ url }) => {
    const p = await getPage();
    try {
      await p.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
      const title = await p.title();
      const text = await p.locator('body').innerText().catch(() => '');
      const summary = text.replace(/\s+/g, ' ').trim().substring(0, 800);
      const links = await (async () => {
        const els = await p.locator('a[href]').all();
        const result = [];
        for (const el of els.slice(0, 8)) {
          const href = await el.getAttribute('href').catch(() => '');
          const txt = (await el.innerText().catch(() => '')).trim().substring(0, 40);
          if (href && txt) result.push({ text: txt, href });
        }
        return result;
      })();
      return makeBrowserResult({ success: true, currentUrl: p.url(), title, summary, links, error: null });
    } catch (e) {
      return makeBrowserResult({ success: false, currentUrl: url, title: '', summary: '', links: [], error: e.message });
    }
  },
  { name: 'browser_navigate', description: '导航到 URL，返回页面标题、内容摘要和链接列表', schema: z.object({ url: z.string().describe('完整 URL') }) }
);

const extractTextTool = tool(
  async ({ selector, maxLength }) => {
    const p = await getPage();
    try {
      const sel = selector || 'body';
      const text = await p.locator(sel).innerText({ timeout: 5000 });
      const truncated = text.replace(/\s+/g, ' ').trim().substring(0, maxLength || 2000);
      return makeBrowserResult({ success: true, selector: sel, text: truncated, currentUrl: p.url(), error: null });
    } catch (e) {
      return makeBrowserResult({ success: false, selector, text: '', currentUrl: p.url(), error: e.message });
    }
  },
  { name: 'browser_extract', description: '从当前页面提取文本内容', schema: z.object({ selector: z.string().optional().describe('CSS 选择器，默认 body'), maxLength: z.number().optional().describe('最大字符数') }) }
);

const screenshotTool = tool(
  async ({ filename }) => {
    const p = await getPage();
    const fname = filename || `screenshot-${Date.now()}.png`;
    const filePath = path.join('./output', fname);
    await p.screenshot({ path: filePath });
    return makeBrowserResult({ success: true, filePath, currentUrl: p.url(), error: null });
  },
  { name: 'browser_screenshot', description: '对当前页面截图', schema: z.object({ filename: z.string().optional().describe('文件名') }) }
);

const tools = [navigateTool, extractTextTool, screenshotTool];
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
const BrowserAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  task: Annotation({ value: (_, r) => r, default: () => '' }),
  stepCount: Annotation({ value: (_, r) => r, default: () => 0 }),
  maxSteps: Annotation({ value: (_, r) => r, default: () => 15 }),
  result: Annotation({ value: (_, r) => r, default: () => '' }),
});

// ============================================================
// 节点
// ============================================================
const agentNode = async (state) => {
  const stepCount = state.stepCount + 1;
  console.log(chalk.cyan(`\n  [Agent 节点] 步骤 ${stepCount}/${state.maxSteps}`));

  const response = await model.invoke([
    new SystemMessage(`你是一个浏览器操作助手，通过浏览器工具完成用户任务。

可用工具：
- browser_navigate：导航到 URL
- browser_extract：提取页面文本内容  
- browser_screenshot：截图

规则：
1. 每次只调用一个工具
2. 根据工具返回的结果决定下一步
3. 任务完成后直接回复文字总结（不再调用工具）
4. 如果连续两次工具都失败，停止并报告错误

当前步骤：${stepCount}/${state.maxSteps}`),
    ...state.messages,
  ]);

  if (response.tool_calls?.length > 0) {
    console.log(chalk.yellow(`  → 调用工具：${response.tool_calls[0].name}`));
  } else {
    console.log(chalk.green(`  → 模型认为任务完成，回复：${response.content?.substring(0, 80)}...`));
  }

  return {
    messages: [response],
    stepCount,
  };
};

const toolNode = async (state) => {
  const lastMsg = state.messages.at(-1);
  const results = [];

  for (const tc of lastMsg.tool_calls ?? []) {
    console.log(chalk.yellow(`  [工具节点] 执行 ${tc.name}...`));
    const t = toolsByName[tc.name];
    if (t) {
      const r = await t.invoke(tc.args);
      results.push(new ToolMessage({ content: r, tool_call_id: tc.id }));
    }
  }

  return { messages: results };
};

const shouldContinue = (state) => {
  const lastMsg = state.messages.at(-1);

  // 超过最大步数
  if (state.stepCount >= state.maxSteps) {
    console.log(chalk.red('  [条件边] 超过最大步数，强制结束'));
    return END;
  }

  // AI 消息有工具调用 → 执行工具
  if (lastMsg instanceof AIMessage && lastMsg.tool_calls?.length > 0) {
    return 'toolNode';
  }

  // AI 消息无工具调用 → 任务完成
  return END;
};

// ============================================================
// 构建图
// ============================================================
const graph = new StateGraph(BrowserAgentState)
  .addNode('agent', agentNode)
  .addNode('toolNode', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['toolNode', END])
  .addEdge('toolNode', 'agent')
  .compile();

// ============================================================
// 运行
// ============================================================
console.log(chalk.bgBlue.white('\n=== 03-browser-agent.mjs ===\n'));

const task = '访问 example.com，提取页面标题和主要内容，然后截图保存';
console.log(chalk.bgMagenta.white(`\n📋 任务：${task}\n`));

try {
  const result = await graph.invoke({
    task,
    messages: [new HumanMessage(task)],
    maxSteps: 10,
  });

  const lastAI = result.messages.filter(m => m instanceof AIMessage).at(-1);
  console.log(chalk.bgGreen.black('\n✅ 任务完成！'));
  console.log('\n最终结果：');
  console.log(lastAI?.content);
  console.log(chalk.gray(`\n共执行 ${result.stepCount} 步`));
} finally {
  if (browser) await browser.close();
}

/**
 * 理解要点：
 * 1. 浏览器 Agent 的核心是"工具返回值 → 模型推理 → 下一步工具"的循环
 * 2. maxSteps 是最重要的安全阀，防止无限循环
 * 3. 工具返回结构化 JSON 让模型能更精准地决策
 * 4. 结束条件：模型不再调用工具（认为任务完成）或达到 maxSteps
 */
