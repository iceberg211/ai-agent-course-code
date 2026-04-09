import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import {
  assertSafeHttpUrl,
  inferFilenameFromUrl,
  sanitizeFilename,
} from '@/tool/utils/url-safety';
import { WorkspaceService } from '@/workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid(),
  url: z.string().url().describe('要下载的远程文件地址'),
  path: z
    .string()
    .min(1)
    .optional()
    .describe('写入 workspace 的相对路径，默认自动推断文件名'),
});

@Injectable()
export class DownloadFileTool implements Tool {
  readonly name = 'download_file';
  readonly description =
    '下载远程文件到任务工作区，适合 PDF、图片、附件和原始资料归档。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;

  constructor(private readonly workspace: WorkspaceService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { task_id, url, path: targetPath } = schema.parse(input);
      assertSafeHttpUrl(url);

      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 8 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiniManus/1.0)' },
      });

      const relativePath = targetPath
        ? targetPath
            .split('/')
            .filter(Boolean)
            .map(sanitizeFilename)
            .join('/')
        : inferFilenameFromUrl(url, 'downloaded-file');
      const safePath = this.workspace.resolveSafePath(task_id, relativePath);
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, Buffer.from(response.data));

      const contentType = response.headers['content-type'] ?? 'application/octet-stream';
      const sizeBytes = Buffer.byteLength(Buffer.from(response.data));

      return {
        success: true,
        output: `文件已下载到 ${relativePath}，大小 ${sizeBytes} bytes`,
        metadata: {
          path: relativePath,
          mimeType: contentType,
          sizeBytes,
          sourceUrl: url,
        },
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'Failed to download file');
    }
  }
}
