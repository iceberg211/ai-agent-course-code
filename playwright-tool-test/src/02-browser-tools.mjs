/**
 * 02-browser-tools.mjs
 * ====================
 * 知识点：把浏览器操作封装为 LangChain 工具
 *
 * 核心问题：工具返回值应该包含什么？
 *
 * ❌ 不好的返回值：
 *   return '操作成功';  // 模型不知道接下来该做什么
 *
 * ✅ 好的返回值（结构化）：
 *   return JSON.stringify({
 *     success: true,
 *     currentUrl: 'https://...',     // 模型知道现在在哪里
 *     title: '页面标题',              // 模型知道页面是什么
 *     extractedText: '...',           // 模型知道页面内容
 *     availableLinks: [...],          // 模型知道可以去哪里
 *     error: null,                    // 模型知道有没有错误
 *   });
 *
 * 本质：浏览器工具不只是"执行动作"，
 *       它的返回值是模型"下一步推理"的输入源
 */

import { chromium } from 'playwright';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';

// 输出目录
const OUTPUT_DIR = './output';
await fs.mkdir(OUTPUT_DIR, { recursive: true });

// ============================================================
// 浏览器会话管理（单例模式）
// ============================================================
// 在 Agent 执行期间，保持同一个浏览器实例（性能 + 共享 Cookie）
let browserInstance = null;
let pageInstance = null;

const getBrowser = async () => {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
    console.log(chalk.gray('  [浏览器] 已启动'));
  }
  return browserInstance;
};

const getPage = async () => {
  const browser = await getBrowser();
  if (!pageInstance || pageInstance.isClosed()) {
    pageInstance = await browser.newPage();
    // 设置 User-Agent，避免被反爬
    await pageInstance.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
  }
  return pageInstance;
};

export const closeBrowser = async () => {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
    console.log(chalk.gray('  [浏览器] 已关闭'));
  }
};

// ============================================================
// 工具1：navigate —— 导航到 URL
// ============================================================
export const navigateTool = tool(
  async ({ url }) => {
    console.log(chalk.cyan(`  [navigate] → ${url}`));
    const page = await getPage();

    try {
      await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });

      const title = await page.title();
      const currentUrl = page.url();

      // 提取页面摘要文本（前600字）
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const summary = bodyText.replace(/\s+/g, ' ').trim().substring(0, 600);

      // 提取主要链接（前10个）
      const linkElements = await page.locator('a[href]').all();
      const links = [];
      for (const el of linkElements.slice(0, 10)) {
        const href = await el.getAttribute('href').catch(() => '');
        const text = (await el.innerText().catch(() => '')).trim().substring(0, 50);
        if (href && text) links.push({ text, href });
      }

      console.log(chalk.green(`  → 成功：${title}`));

      return JSON.stringify({
        success: true,
        currentUrl,
        title,
        summary,
        availableLinks: links,
        error: null,
      });
    } catch (err) {
      console.log(chalk.red(`  → 失败：${err.message}`));
      return JSON.stringify({
        success: false,
        currentUrl: url,
        title: '',
        summary: '',
        availableLinks: [],
        error: err.message,
      });
    }
  },
  {
    name: 'browser_navigate',
    description: '导航浏览器到指定 URL，返回页面标题、内容摘要和可用链接。',
    schema: z.object({
      url: z.string().url().describe('要访问的完整 URL，包含 https://'),
    }),
  }
);

// ============================================================
// 工具2：extract_text —— 提取页面文本
// ============================================================
export const extractTextTool = tool(
  async ({ selector, maxLength }) => {
    console.log(chalk.cyan(`  [extract_text] selector=${selector ?? 'body'}`));
    const page = await getPage();

    try {
      const sel = selector ?? 'body';
      await page.waitForSelector(sel, { timeout: 5000 });
      const text = await page.locator(sel).innerText();
      const truncated = text.replace(/\s+/g, ' ').trim().substring(0, maxLength ?? 2000);

      console.log(chalk.green(`  → 提取到 ${truncated.length} 字符`));

      return JSON.stringify({
        success: true,
        selector: sel,
        currentUrl: page.url(),
        text: truncated,
        totalLength: text.length,
        error: null,
      });
    } catch (err) {
      console.log(chalk.red(`  → 失败：${err.message}`));
      return JSON.stringify({
        success: false,
        selector: selector ?? 'body',
        currentUrl: page.url(),
        text: '',
        totalLength: 0,
        error: err.message,
      });
    }
  },
  {
    name: 'browser_extract_text',
    description: '从当前页面提取文本内容。可指定 CSS 选择器，默认提取整个页面正文。',
    schema: z.object({
      selector: z.string().optional().describe('CSS 选择器，不填则提取整个 body'),
      maxLength: z.number().optional().describe('最大字符数，默认 2000'),
    }),
  }
);

// ============================================================
// 工具3：click —— 点击元素
// ============================================================
export const clickTool = tool(
  async ({ selector }) => {
    console.log(chalk.cyan(`  [click] selector=${selector}`));
    const page = await getPage();

    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.locator(selector).first().click();

      // 等待导航完成（点击后可能跳转）
      await page.waitForLoadState('domcontentloaded').catch(() => {});

      const title = await page.title();
      const currentUrl = page.url();

      console.log(chalk.green(`  → 点击成功，当前页：${title}`));

      return JSON.stringify({
        success: true,
        currentUrl,
        title,
        error: null,
      });
    } catch (err) {
      console.log(chalk.red(`  → 失败：${err.message}`));
      return JSON.stringify({
        success: false,
        currentUrl: page.url(),
        title: '',
        error: err.message,
      });
    }
  },
  {
    name: 'browser_click',
    description: '点击页面上的元素（按钮、链接等）。',
    schema: z.object({
      selector: z.string().describe('CSS 选择器，如 "button.submit"、"a[href*=about]"'),
    }),
  }
);

// ============================================================
// 工具4：screenshot —— 截图
// ============================================================
export const screenshotTool = tool(
  async ({ filename }) => {
    console.log(chalk.cyan(`  [screenshot] → ${filename ?? 'auto'}`));
    const page = await getPage();

    const fname = filename ?? `screenshot-${Date.now()}.png`;
    const filePath = path.join(OUTPUT_DIR, fname);

    try {
      await page.screenshot({ path: filePath, fullPage: false });
      const title = await page.title();
      const currentUrl = page.url();

      console.log(chalk.green(`  → 截图保存至 ${filePath}`));

      return JSON.stringify({
        success: true,
        filePath,
        currentUrl,
        title,
        error: null,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        filePath: '',
        currentUrl: page.url(),
        title: '',
        error: err.message,
      });
    }
  },
  {
    name: 'browser_screenshot',
    description: '对当前页面截图，保存到本地文件。',
    schema: z.object({
      filename: z.string().optional().describe('文件名，默认自动生成（如 screenshot-1234.png）'),
    }),
  }
);

// ============================================================
// 演示：直接调用工具（不通过 Agent）
// ============================================================
console.log(chalk.bgBlue.white('\n=== 02-browser-tools.mjs ===\n'));
console.log(chalk.cyan('演示：直接调用封装好的浏览器工具\n'));

// 演示 navigate
console.log(chalk.bgYellow.black('【工具1】navigate'));
const navResult = await navigateTool.invoke({ url: 'https://example.com' });
const navData = JSON.parse(navResult);
console.log('  成功？', navData.success);
console.log('  标题：', navData.title);
console.log('  摘要：', navData.summary?.substring(0, 100) + '...');
console.log('  链接数：', navData.availableLinks?.length);

// 演示 extract_text
console.log(chalk.bgYellow.black('\n【工具2】extract_text'));
const extractResult = await extractTextTool.invoke({ selector: 'h1', maxLength: 200 });
const extractData = JSON.parse(extractResult);
console.log('  成功？', extractData.success);
console.log('  提取文本：', extractData.text);

// 演示 screenshot
console.log(chalk.bgYellow.black('\n【工具3】screenshot'));
const ssResult = await screenshotTool.invoke({ filename: 'demo.png' });
const ssData = JSON.parse(ssResult);
console.log('  成功？', ssData.success);
console.log('  文件路径：', ssData.filePath);

// 关闭浏览器
await closeBrowser();

console.log(chalk.bgGreen.black('\n✅ 演示完成！'));
console.log(chalk.gray('这 4 个工具就是简易版 Manus 的浏览器工具集第一版'));

/**
 * 理解要点：
 * 1. 工具返回值必须是结构化的 JSON，包含足够的上下文供模型推理
 * 2. 浏览器实例要复用（单例），不要每次调用都新开浏览器
 * 3. 每个工具里都要有 try/catch + 错误信息返回（模型需要知道失败原因）
 * 4. timeout 控制 + waitForSelector 是稳定性的关键
 */
