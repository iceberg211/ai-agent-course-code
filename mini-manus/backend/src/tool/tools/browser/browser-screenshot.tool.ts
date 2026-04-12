import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { sanitizeFilename } from '@/tool/utils/url-safety';
import { BrowserSessionService } from '@/browser/browser-session.service';
import { WorkspaceService } from '@/workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid().optional(),
  session_id: z.string().uuid().describe('browser_open 返回的 session_id'),
  path: z
    .string()
    .min(1)
    .optional()
    .describe('写入 workspace 的相对路径，默认写入 browser-screenshots 目录'),
  full_page: z.boolean().optional().default(true),
  timeout_ms: z.coerce.number().int().min(1_000).max(60_000).optional(),
});

function normalizeScreenshotPath(
  requestedPath: string | undefined,
  sessionId: string,
): string {
  const fallback = `browser-screenshots/${sessionId}.png`;
  const rawPath = requestedPath?.trim() || fallback;
  const normalized = rawPath
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitizeFilename(segment))
    .filter(Boolean)
    .join('/');

  if (!normalized) return fallback;
  return normalized.toLowerCase().endsWith('.png')
    ? normalized
    : `${normalized}.png`;
}

@Injectable()
export class BrowserScreenshotTool implements Tool {
  readonly name = 'browser_screenshot';
  readonly description =
    '保存已打开浏览器会话的 PNG 截图到任务 workspace。只截图，不点击、不输入。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;
  readonly cacheable = false;

  constructor(
    private readonly browserSessions: BrowserSessionService,
    private readonly workspace: WorkspaceService,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = schema.parse(input);
      if (!parsed.task_id) {
        throw new Error('browser_screenshot 缺少 task_id');
      }

      const screenshot = await this.browserSessions.takeScreenshot({
        sessionId: parsed.session_id,
        fullPage: parsed.full_page,
        timeoutMs: parsed.timeout_ms,
      });
      const relativePath = normalizeScreenshotPath(
        parsed.path,
        parsed.session_id,
      );
      const safePath = this.workspace.resolveSafePath(
        parsed.task_id,
        relativePath,
      );
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, screenshot.buffer);

      const output = {
        session_id: screenshot.sessionId,
        title: screenshot.title,
        url: screenshot.url,
        path: relativePath,
        size_bytes: screenshot.sizeBytes,
      };

      return {
        success: true,
        output: truncateOutput(JSON.stringify(output, null, 2)),
        metadata: output,
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'browser_screenshot 执行失败');
    }
  }
}
