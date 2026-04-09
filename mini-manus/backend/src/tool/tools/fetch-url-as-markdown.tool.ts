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
  url: z.string().url().describe('需要抓取为 Markdown 的网页地址'),
});

function toMarkdown(html: string, url: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, iframe, noscript').remove();

  const title = $('title').first().text().trim();
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
  }
  lines.push(`来源：${url}`);
  lines.push('');

  $('main, article, body')
    .first()
    .find('h1, h2, h3, p, li')
    .each((_, element) => {
      const tagName = element.tagName.toLowerCase();
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (!text) return;

      if (tagName === 'h1') lines.push(`# ${text}`);
      else if (tagName === 'h2') lines.push(`## ${text}`);
      else if (tagName === 'h3') lines.push(`### ${text}`);
      else if (tagName === 'li') lines.push(`- ${text}`);
      else lines.push(text);

      lines.push('');
    });

  const links = $('a[href]')
    .slice(0, 12)
    .toArray()
    .map((node) => {
      const href = $(node).attr('href');
      const text = $(node).text().replace(/\s+/g, ' ').trim();
      if (!href || !text) return null;
      return `- [${text}](${href})`;
    })
    .filter(Boolean) as string[];

  if (links.length > 0) {
    lines.push('## 相关链接');
    lines.push('');
    lines.push(...links);
  }

  return lines.join('\n').trim();
}

@Injectable()
export class FetchUrlAsMarkdownTool implements Tool {
  readonly name = 'fetch_url_as_markdown';
  readonly description =
    '抓取网页正文并尽量保留标题层级，输出更适合后续写作的 Markdown 内容。';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { url } = schema.parse(input);
      assertSafeHttpUrl(url);

      const response = await axios.get(url, {
        timeout: 30000,
        maxContentLength: 2 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiniManus/1.0)' },
      });

      const markdown = toMarkdown(String(response.data ?? ''), url);
      return {
        success: true,
        output: truncateOutput(markdown || `# ${url}\n\n(空页面)`),
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'Failed to fetch URL as markdown');
    }
  }
}
