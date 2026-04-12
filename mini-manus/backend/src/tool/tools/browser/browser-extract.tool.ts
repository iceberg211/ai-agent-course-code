import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { BrowserSessionService } from '@/browser/browser-session.service';

const schema = z.object({
  session_id: z.string().uuid().describe('browser_open 返回的 session_id'),
  selector: z
    .string()
    .min(1)
    .optional()
    .describe('可选 CSS 选择器，不填则抽取 body 文本'),
  max_length: z.coerce.number().int().min(1).max(50_000).optional(),
  timeout_ms: z.coerce.number().int().min(1_000).max(60_000).optional(),
});

@Injectable()
export class BrowserExtractTool implements Tool {
  readonly name = 'browser_extract';
  readonly description =
    '从已打开的浏览器会话中抽取页面文本，支持可选 CSS 选择器。不会点击、输入或登录。';
  readonly schema = schema;
  readonly type = 'read-only' as const;
  readonly cacheable = false;

  constructor(private readonly browserSessions: BrowserSessionService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = schema.parse(input);
      const result = await this.browserSessions.extract({
        sessionId: parsed.session_id,
        selector: parsed.selector,
        maxLength: parsed.max_length,
        timeoutMs: parsed.timeout_ms,
      });

      const output = [
        `session_id: ${result.sessionId}`,
        `title: ${result.title || '(无标题)'}`,
        `url: ${result.url}`,
        result.truncated ? 'text_truncated: true' : 'text_truncated: false',
        '',
        result.text || '(页面没有可抽取文本)',
      ].join('\n');

      return {
        success: true,
        output: truncateOutput(output),
        metadata: {
          session_id: result.sessionId,
          title: result.title,
          url: result.url,
          truncated: result.truncated,
        },
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'browser_extract 执行失败');
    }
  }
}
