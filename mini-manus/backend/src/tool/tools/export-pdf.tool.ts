import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { createPdfBufferFromText } from '@/tool/utils/pdf-export';
import { classifyToolError } from '@/tool/utils/tool-error';
import { sanitizeFilename } from '@/tool/utils/url-safety';
import { WorkspaceService } from '@/workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid(),
  title: z.string().min(1).describe('PDF 标题'),
  content: z
    .string()
    .min(1)
    .describe('需要写入 PDF 的纯文本/Markdown/代码内容'),
  path: z
    .string()
    .min(1)
    .optional()
    .describe('导出的 PDF 相对路径，默认使用 task-report.pdf'),
});

@Injectable()
export class ExportPdfTool implements Tool {
  readonly name = 'export_pdf';
  readonly description =
    '将文本、Markdown、代码或图表源码导出为 PDF 文件并写入任务工作区。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;

  constructor(private readonly workspace: WorkspaceService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { task_id, title, content, path: outputPath } = schema.parse(input);
      const normalizedPath = outputPath
        ? outputPath.split('/').filter(Boolean).map(sanitizeFilename).join('/')
        : 'task-report.pdf';
      const safePath = this.workspace.resolveSafePath(task_id, normalizedPath);
      const pdfBytes = await createPdfBufferFromText(title, content);

      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, Buffer.from(pdfBytes));

      return {
        success: true,
        output: `PDF 已导出到 ${normalizedPath}`,
        metadata: {
          path: normalizedPath,
          title,
          sizeBytes: pdfBytes.byteLength,
          mimeType: 'application/pdf',
        },
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'Failed to export PDF');
    }
  }
}
