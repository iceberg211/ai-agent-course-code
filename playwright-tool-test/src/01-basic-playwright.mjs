/**
 * 01-basic-playwright.mjs
 * =======================
 * 知识点：Playwright 基础操作
 *
 * Playwright 是什么？
 * - 一个可编程的浏览器控制库
 * - 支持 Chromium / Firefox / WebKit
 * - 可以在没有 GUI 的服务器上运行（headless 模式）
 *
 * 核心 API：
 * - chromium.launch()  → 启动浏览器
 * - browser.newPage()  → 打开新标签页
 * - page.goto(url)     → 导航到 URL
 * - page.locator(sel)  → 找到页面元素
 * - page.screenshot()  → 截图
 * - page.close()       → 关闭
 *
 * ⚡ 运行前需要安装浏览器：npm run install:browser
 */

import { chromium } from 'playwright';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';

// ============================================================
// 确保输出目录存在
// ============================================================
const outputDir = './output';
await fs.mkdir(outputDir, { recursive: true });

// ============================================================
// 演示一：基础导航和内容提取
// ============================================================
console.log(chalk.bgBlue.white('\n=== 01-basic-playwright.mjs ===\n'));
console.log(chalk.cyan('【演示1】基础导航：打开页面，提取标题和内容'));

// 启动浏览器（headless: true 表示无界面，在服务器上运行）
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  // 1. 导航到页面
  console.log(chalk.gray('  → 导航到 example.com...'));
  await page.goto('https://example.com', { timeout: 10000 });

  // 2. 获取页面标题
  const title = await page.title();
  console.log(chalk.green(`  → 页面标题：${title}`));

  // 3. 获取当前 URL
  const url = page.url();
  console.log(chalk.green(`  → 当前 URL：${url}`));

  // 4. 提取页面文本内容（整个 body）
  const bodyText = await page.locator('body').innerText();
  console.log(chalk.green(`  → 页面文本（前200字）：${bodyText.substring(0, 200)}`));

  // 5. 提取特定元素
  const heading = await page.locator('h1').innerText().catch(() => '（未找到 h1）');
  console.log(chalk.green(`  → H1 标题：${heading}`));

  // ============================================================
  // 演示二：截图
  // ============================================================
  console.log(chalk.cyan('\n【演示2】截图'));

  const screenshotPath = path.join(outputDir, 'screenshot-example.png');
  await page.screenshot({ path: screenshotPath });
  console.log(chalk.green(`  → 截图已保存：${screenshotPath}`));

  // 截全页面（包括滚动区域）
  const fullPagePath = path.join(outputDir, 'screenshot-fullpage.png');
  await page.screenshot({ path: fullPagePath, fullPage: true });
  console.log(chalk.green(`  → 全页截图已保存：${fullPagePath}`));

  // ============================================================
  // 演示三：获取页面所有链接
  // ============================================================
  console.log(chalk.cyan('\n【演示3】提取页面上所有链接'));

  const links = await page.locator('a').all();
  console.log(`  → 找到 ${links.length} 个链接：`);
  for (const link of links.slice(0, 5)) {
    const href = await link.getAttribute('href').catch(() => '');
    const text = await link.innerText().catch(() => '');
    if (href) {
      console.log(chalk.gray(`     - [${text.trim()}](${href})`));
    }
  }

  // ============================================================
  // 演示四：等待元素出现（处理动态页面）
  // ============================================================
  console.log(chalk.cyan('\n【演示4】等待元素出现（动态页面处理）'));

  await page.goto('https://example.com');
  // waitForSelector 等待元素出现再操作，避免元素还没渲染就去找
  await page.waitForSelector('h1', { timeout: 5000 });
  const h1 = await page.locator('h1').innerText();
  console.log(chalk.green(`  → 等待完成，H1: ${h1}`));

  // ============================================================
  // 演示五：页面元信息提取
  // ============================================================
  console.log(chalk.cyan('\n【演示5】提取页面元信息（Meta 标签）'));

  const metaDescription = await page.locator('meta[name="description"]').getAttribute('content').catch(() => '（无描述）');
  console.log(chalk.green(`  → Meta Description：${metaDescription}`));

} catch (error) {
  console.error(chalk.red(`\n❌ 出错：${error.message}`));
} finally {
  // 记得关闭浏览器！
  await browser.close();
  console.log(chalk.gray('\n  浏览器已关闭'));
}

console.log(chalk.bgGreen.black('\n✅ 演示完成！'));
console.log(chalk.gray('截图文件保存在：./output/ 目录'));

/**
 * 理解要点：
 * 1. Playwright 的核心就是 browser → page → locator → action
 * 2. locator 是惰性的，不会立即执行，只有调用 innerText()/click() 等才真正执行
 * 3. 所有操作都是 async，要 await
 * 4. 一定要 browser.close()，否则进程不退出
 * 5. timeout 很重要：网络不好时页面可能加载很慢
 */
