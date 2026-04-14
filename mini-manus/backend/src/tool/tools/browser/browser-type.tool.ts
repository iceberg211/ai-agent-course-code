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
    .describe('输入框的 CSS 选择器，如 input[name="q"] 或 #search'),
  text: z.string().describe('要输入的文本内容'),
  clear_first: z
    .boolean()
    .default(false)
    .optional()
    .describe('输入前先清空已有内容，默认 false'),
  timeout_ms: z.number().int().min(100).max(30_000).default(10_000).optional(),
});

@Injectable()
export class BrowserTypeTool implements Tool {
  readonly name = 'browser_type';
  readonly description =
    '在已打开的浏览器会话中向输入框输入文本。' +
    '适合填写搜索框、表单字段等场景。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;

  constructor(private readonly browser: BrowserSessionService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { session_id, selector, text, clear_first, timeout_ms } =
        schema.parse(input);
      const result = await this.browser.type({
        sessionId: session_id,
        selector,
        text,
        clearFirst: clear_first,
        timeoutMs: timeout_ms,
      });
      return {
        success: true,
        output: `已在 ${selector} 输入文本（${text.length} 字符）| 当前页面：${result.title}`,
        metadata: { sessionId: result.sessionId, url: result.url },
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'browser_type failed');
    }
  }
}
