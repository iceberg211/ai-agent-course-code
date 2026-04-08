import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';

const schema = z.object({
  url: z.string().url().describe('URL to fetch and extract text from'),
});

const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/metadata\.google/i,
];

@Injectable()
export class BrowseUrlTool implements Tool {
  readonly name = 'browse_url';
  readonly description = 'Fetch and extract readable text content from a URL.';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  async execute(input: unknown): Promise<ToolResult> {
    const parsed = schema.parse(input);
    const { url } = parsed;

    // SSRF protection
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return {
        success: false,
        output: '',
        error: 'Only http/https URLs are allowed',
      };
    }
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(url)) {
        return {
          success: false,
          output: '',
          error: 'URL points to a blocked address',
        };
      }
    }

    try {
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
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: '',
        error: `Failed to browse URL: ${msg}`,
      };
    }
  }
}
