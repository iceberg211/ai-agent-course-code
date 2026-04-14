import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { BrowserSessionService } from '@/browser/browser-session.service';

const schema = z.object({
  session_id: z.string().min(1).describe('browser_open 返回的会话 ID'),
  selector: z
    .string()
    .min(1)
    .describe('CSS 选择器，如 button.submit 或 #login-btn'),
  timeout_ms: z.number().int().min(100).max(30_000).default(10_000).optional(),
  screenshot_after: z
    .boolean()
    .default(false)
    .optional()
    .describe('点击后自动截图（默认 false）。截图保存在 workspace，可在审计中查看'),
});

@Injectable()
export class BrowserClickTool implements Tool {
  readonly name = 'browser_click';
  readonly description =
    '在已打开的浏览器会话中点击指定元素（按 CSS 选择器定位）。' +
    '点击后页面可能跳转，建议用 browser_wait_for_selector 等待加载完成。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;

  constructor(private readonly browser: BrowserSessionService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { session_id, selector, timeout_ms, screenshot_after } = schema.parse(input);
      const result = await this.browser.click({
        sessionId: session_id,
        selector,
        timeoutMs: timeout_ms,
      });

      const meta: Record<string, unknown> = { sessionId: result.sessionId, url: result.url };

      // 审计建议：如需截图留证，在 browser_click 之后用 browser_screenshot 工具单独执行。
      // screenshot_after=true 只标记审计需求，实际截图由 Planner 安排独立步骤完成。
      if (screenshot_after) {
        meta.auditHint = `建议在此步骤后调用 browser_screenshot 以保存 ${result.url} 的页面状态`;
      }

      return {
        success: true,
        output: `已点击 ${selector} | 当前页面：${result.title} (${result.url})`,
        metadata: meta,
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'browser_click failed');
    }
  }
}
