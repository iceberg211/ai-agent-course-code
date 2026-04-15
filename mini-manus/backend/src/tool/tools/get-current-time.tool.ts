import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';

const schema = z.object({
  timezone: z
    .string()
    .optional()
    .describe(
      'IANA timezone name, e.g. "Asia/Shanghai", "America/New_York". Defaults to UTC.',
    ),
});

@Injectable()
export class GetCurrentTimeTool implements Tool {
  readonly name = 'get_current_time';
  readonly description =
    '返回当前日期和时间。用于判断信息时效性、计算日期差、或在报告中注明生成时间。';
  readonly schema = schema;
  readonly type = 'read-only' as const;
  readonly cacheable = false; // 时间每次都不同，不缓存

  execute(input: unknown): Promise<ToolResult> {
    const { timezone } = schema.parse(input);
    const now = new Date();

    let localString: string;
    try {
      localString = now.toLocaleString('zh-CN', {
        timeZone: timezone ?? 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      // Invalid timezone falls back to UTC
      localString = now.toLocaleString('zh-CN', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    const output = [
      `当前时间：${localString}`,
      `时区：${timezone ?? 'UTC'}`,
      `ISO 8601：${now.toISOString()}`,
      `Unix 时间戳：${Math.floor(now.getTime() / 1000)}`,
    ].join('\n');

    return Promise.resolve({
      success: true,
      output,
      structuredData: {
        iso: now.toISOString(),
        local: localString,
        timezone: timezone ?? 'UTC',
        unixTimestamp: Math.floor(now.getTime() / 1000),
      },
    });
  }
}
