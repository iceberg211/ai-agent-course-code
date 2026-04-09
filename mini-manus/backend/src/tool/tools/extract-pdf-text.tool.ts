import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { WorkspaceService } from '@/workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid(),
  path: z.string().min(1).describe('workspace 中 PDF 文件的相对路径'),
});

@Injectable()
export class ExtractPdfTextTool implements Tool {
  readonly name = 'extract_pdf_text';
  readonly description =
    '提取 workspace 中 PDF 文件的纯文本内容，供调研、总结和写作步骤继续使用。';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  constructor(private readonly workspace: WorkspaceService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { task_id, path } = schema.parse(input);
      const safePath = this.workspace.resolveSafePath(task_id, path);
      const buffer = await fs.readFile(safePath);
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();

      return {
        success: true,
        output: truncateOutput(parsed.text.trim() || '(empty pdf)'),
        metadata: {
          path,
          pageCount: parsed.total,
        },
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'Failed to extract PDF text');
    }
  }
}
