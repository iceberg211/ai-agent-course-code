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
  task_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  url: z.string().url().describe('需要用真实浏览器打开的网页地址'),
  timeout_ms: z.coerce.number().int().min(1_000).max(60_000).optional(),
});

@Injectable()
export class BrowserOpenTool implements Tool {
  readonly name = 'browser_open';
  readonly description =
    '用无头浏览器打开动态网页，返回 session_id、最终 URL、标题和 HTTP 状态。仅用于读取页面。';
  readonly schema = schema;
  readonly type = 'read-only' as const;
  readonly cacheable = false;

  constructor(private readonly browserSessions: BrowserSessionService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = schema.parse(input);
      if (!parsed.task_id) {
        throw new Error('browser_open 缺少 task_id');
      }

      const result = await this.browserSessions.open({
        taskId: parsed.task_id,
        runId: parsed.run_id,
        url: parsed.url,
        timeoutMs: parsed.timeout_ms,
      });

      const output = {
        session_id: result.sessionId,
        title: result.title,
        url: result.url,
        status: result.status,
      };

      return {
        success: true,
        output: truncateOutput(JSON.stringify(output, null, 2)),
        metadata: output,
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'browser_open 执行失败');
    }
  }
}
