import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { assertSafeHttpUrl } from '@/tool/utils/url-safety';

const schema = z.object({
  url: z.string().url().describe('URL to fetch and extract text from'),
});

@Injectable()
export class BrowseUrlTool implements Tool {
  readonly name = 'browse_url';
  readonly description = 'Fetch and extract readable text content from a URL.';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = schema.parse(input);
      const { url } = parsed;
      assertSafeHttpUrl(url);

      const response = await axios.get(url, {
        timeout: 30000,
        maxContentLength: 1024 * 1024, // 1MB
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiniManus/1.0)' },
      });

      const $ = cheerio.load(response.data as string);
      $('script, style, nav, footer, header, iframe, noscript').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();

      return { success: true, output: truncateOutput(text || '(empty page)') };
    } catch (err: unknown) {
      return classifyToolError(err, 'Failed to browse URL');
    }
  }
}
