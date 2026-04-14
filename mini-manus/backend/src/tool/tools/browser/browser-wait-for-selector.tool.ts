import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { BrowserSessionService } from '@/browser/browser-session.service';

const schema = z.object({
  session_id: z.string().min(1).describe('browser_open 返回的会话 ID'),
  selector: z.string().min(1).describe('等待出现的元素 CSS 选择器'),
  state: z
    .enum(['visible', 'attached', 'detached', 'hidden'])
    .default('visible')
    .optional()
    .describe(
      '等待的状态：visible=可见（默认），attached=已挂载，detached=已移除，hidden=已隐藏',
    ),
  timeout_ms: z.number().int().min(100).max(30_000).default(10_000).optional(),
});

@Injectable()
export class BrowserWaitForSelectorTool implements Tool {
  readonly name = 'browser_wait_for_selector';
  readonly description =
    '等待浏览器会话中指定元素出现或变为指定状态。' +
    '常用于等待页面跳转后的内容加载，如按钮点击后等待搜索结果。';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  constructor(private readonly browser: BrowserSessionService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { session_id, selector, state, timeout_ms } = schema.parse(input);
      const result = await this.browser.waitForSelector({
        sessionId: session_id,
        selector,
        state: state as 'visible' | 'attached' | 'detached' | 'hidden',
        timeoutMs: timeout_ms,
      });

      if (result.found) {
        return {
          success: true,
          output: `元素 ${selector} 已${state ?? 'visible'} | 当前页面：${result.title} (${result.url})`,
          metadata: {
            sessionId: result.sessionId,
            url: result.url,
            found: true,
          },
        };
      } else {
        return {
          success: false,
          output: `等待超时：元素 ${selector} 在 ${timeout_ms ?? 10000}ms 内未${state ?? 'visible'}`,
          error: `selector_timeout: ${selector}`,
          errorCode: 'timeout',
          metadata: {
            sessionId: result.sessionId,
            url: result.url,
            found: false,
          },
        };
      }
    } catch (err: unknown) {
      return classifyToolError(err, 'browser_wait_for_selector failed');
    }
  }
}
