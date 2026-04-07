/**
 * 04-safe-browser-tools.mjs
 * =========================
 * 知识点：工具安全边界
 *
 * 当 Agent 有了文件读写、命令执行、浏览器操作能力后，
 * 必须建立 4 个安全层：
 *
 * Layer 1 — URL 白名单/黑名单（防止访问危险站点）
 * Layer 2 — 动作次数限制（防止无限循环）
 * Layer 3 — 单步超时（防止卡住）
 * Layer 4 — 总任务超时（防止长时间占用资源）
 *
 * 这一节不是讲"怎么用 Playwright"，
 * 而是讲"怎么让 Agent 工具变成可交付的产品能力"
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import chalk from 'chalk';

// ============================================================
// 安全配置（生产中放入 .env 或配置服务）
// ============================================================
const SECURITY_CONFIG = {
  // URL 黑名单：禁止访问这些域名
  blockedDomains: [
    'localhost',
    '127.0.0.1',
    '192.168.',
    '10.',
    '172.16.',
    'internal.',
  ],

  // URL 白名单（可选，如果配置了只允许访问这些）
  // allowedDomains: ['example.com', 'github.com'],

  // 单个工具调用超时（毫秒）
  toolTimeoutMs: 15000,

  // 允许文件写入的目录（只能写到这里面）
  allowedWriteDir: './output',

  // 单次提取文本最大长度
  maxExtractLength: 5000,

  // 截图最大宽度（防止内存爆炸）
  screenshotMaxWidth: 1280,
};

// ============================================================
// 全局计数器（一次任务执行里共享）
// ============================================================
let actionCount = 0;
const MAX_ACTIONS_PER_TASK = 30;

export const resetActionCount = () => { actionCount = 0; };

// ============================================================
// 安全检查工具函数
// ============================================================

/**
 * 检查 URL 是否安全
 */
const checkUrlSafety = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: `无效 URL：${url}` };
  }

  // 只允许 https（可按需开放 http）
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return { safe: false, reason: `不允许的协议：${parsed.protocol}` };
  }

  // 检查黑名单
  for (const blocked of SECURITY_CONFIG.blockedDomains) {
    if (parsed.hostname.includes(blocked)) {
      return { safe: false, reason: `域名被封锁（内网保护）：${parsed.hostname}` };
    }
  }

  return { safe: true, reason: '' };
};

/**
 * 带超时的 Promise 包装
 */
const withTimeout = (promise, ms, errorMsg) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMsg ?? `操作超时（${ms}ms）`)), ms)
  );
  return Promise.race([promise, timeout]);
};

/**
 * 检查动作次数限制
 */
const checkActionLimit = () => {
  actionCount++;
  if (actionCount > MAX_ACTIONS_PER_TASK) {
    throw new Error(`已超过本次任务最大操作次数（${MAX_ACTIONS_PER_TASK}次），任务自动终止。`);
  }
  return actionCount;
};

// ============================================================
// 安全版 navigate 工具
// ============================================================
export const safeNavigateTool = tool(
  async ({ url }) => {
    // 安全检查1：动作次数
    const count = checkActionLimit();
    console.log(chalk.cyan(`  [safe_navigate #${count}] → ${url}`));

    // 安全检查2：URL 合法性
    const { safe, reason } = checkUrlSafety(url);
    if (!safe) {
      console.log(chalk.red(`  → 🚫 被安全策略拦截：${reason}`));
      return JSON.stringify({
        success: false,
        blocked: true,
        reason,
        currentUrl: '',
        title: '',
        summary: '',
        error: reason,
      });
    }

    // 安全检查3：超时控制
    try {
      const result = await withTimeout(
        // 模拟实际的页面导航（真实代码里 await page.goto(url, ...)）
        (async () => {
          await new Promise(r => setTimeout(r, 300)); // 模拟网络延迟
          return {
            title: `页面标题（${url}）`,
            currentUrl: url,
            summary: `页面摘要内容...（实际会调用 Playwright）`,
            links: [],
          };
        })(),
        SECURITY_CONFIG.toolTimeoutMs,
        `导航超时（${SECURITY_CONFIG.toolTimeoutMs}ms）：${url}`
      );

      console.log(chalk.green(`  → ✅ 成功（操作次数：${count}/${MAX_ACTIONS_PER_TASK}）`));
      return JSON.stringify({ success: true, ...result, error: null });

    } catch (err) {
      console.log(chalk.red(`  → ❌ 失败：${err.message}`));
      return JSON.stringify({ success: false, currentUrl: url, title: '', summary: '', error: err.message });
    }
  },
  {
    name: 'safe_navigate',
    description: '（安全版）导航到 URL。内网 IP 和不安全域名会被拦截。',
    schema: z.object({ url: z.string().describe('要访问的 URL') }),
  }
);

// ============================================================
// 安全版 file_write 工具
// ============================================================
export const safeFileWriteTool = tool(
  async ({ filename, content }) => {
    checkActionLimit();

    const path = await import('node:path');
    const fs = await import('node:fs/promises');

    // 安全检查：路径穿越攻击防护
    const allowedDir = SECURITY_CONFIG.allowedWriteDir;
    const targetPath = path.default.resolve(allowedDir, filename);
    const resolvedAllowed = path.default.resolve(allowedDir);

    if (!targetPath.startsWith(resolvedAllowed)) {
      const reason = `路径越界（路径穿越攻击防护）：${filename}`;
      console.log(chalk.red(`  [safe_file_write] 🚫 ${reason}`));
      return JSON.stringify({ success: false, blocked: true, reason, error: reason });
    }

    // 检查内容长度（防止写入超大文件）
    if (content.length > 500_000) {
      return JSON.stringify({ success: false, error: '文件内容超过 500KB 限制' });
    }

    try {
      await fs.default.mkdir(allowedDir, { recursive: true });
      await fs.default.writeFile(targetPath, content, 'utf-8');
      console.log(chalk.green(`  [safe_file_write] ✅ 写入：${targetPath}（${content.length} 字符）`));
      return JSON.stringify({ success: true, filePath: targetPath, size: content.length, error: null });
    } catch (err) {
      return JSON.stringify({ success: false, filePath: targetPath, error: err.message });
    }
  },
  {
    name: 'safe_file_write',
    description: '（安全版）写入文件，只允许写入 ./output/ 目录，防止路径穿越攻击。',
    schema: z.object({
      filename: z.string().describe('文件名（不含目录路径），如 report.md'),
      content: z.string().describe('文件内容'),
    }),
  }
);

// ============================================================
// 演示：安全边界在实际中的效果
// ============================================================
console.log(chalk.bgBlue.white('\n=== 04-safe-browser-tools.mjs ===\n'));

// 测试1：正常访问
console.log(chalk.bgYellow.black('【测试1】正常访问外部网站'));
const r1 = JSON.parse(await safeNavigateTool.invoke({ url: 'https://example.com' }));
console.log('  结果：', r1.success ? '✅ 允许' : `❌ 拦截（${r1.reason}）`);

// 测试2：访问内网地址（被拦截）
console.log(chalk.bgYellow.black('\n【测试2】尝试访问内网地址（应被拦截）'));
const r2 = JSON.parse(await safeNavigateTool.invoke({ url: 'http://192.168.1.1' }));
console.log('  结果：', r2.success ? '⚠️ 允许（安全漏洞！）' : `✅ 拦截（${r2.reason}）`);

// 测试3：路径穿越攻击（被拦截）
console.log(chalk.bgYellow.black('\n【测试3】路径穿越攻击（应被拦截）'));
const r3 = JSON.parse(await safeFileWriteTool.invoke({
  filename: '../../etc/passwd',
  content: 'injected content'
}));
console.log('  结果：', r3.success ? '⚠️ 成功（安全漏洞！）' : `✅ 拦截（${r3.reason}）`);

// 测试4：正常文件写入
console.log(chalk.bgYellow.black('\n【测试4】正常文件写入（应成功）'));
const r4 = JSON.parse(await safeFileWriteTool.invoke({
  filename: 'test-output.md',
  content: '# 测试报告\n\n这是一个安全的文件写入测试。'
}));
console.log('  结果：', r4.success ? `✅ 写入成功（${r4.filePath}）` : `❌ 失败（${r4.error}）`);

// 测试5：超过最大操作次数
console.log(chalk.bgYellow.black('\n【测试5】超过操作次数限制（应触发保护）'));
try {
  for (let i = 0; i < 35; i++) {
    await safeNavigateTool.invoke({ url: 'https://example.com' });
  }
} catch (err) {
  console.log('  结果：✅ 触发保护：' + err.message);
}

console.log(chalk.bgGreen.black('\n✅ 安全边界演示完成！'));
console.log(chalk.gray('\n【生产建议】'));
console.log(chalk.gray('  1. URL 黑名单改为从配置中心读取，支持动态更新'));
console.log(chalk.gray('  2. actionCount 改为 Redis 计数器，支持分布式限流'));
console.log(chalk.gray('  3. 可疑操作（路径穿越、内网访问）要写安全日志'));
console.log(chalk.gray('  4. 高风险操作（删除文件、执行命令）要触发 interrupt 等待人工确认'));
