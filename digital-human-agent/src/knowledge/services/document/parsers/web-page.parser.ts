import { Injectable, Logger } from '@nestjs/common';
import { extname } from 'node:path';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
} from './parser.interface';

@Injectable()
export class WebPageParser implements DocumentParserProvider {
  private readonly logger = new Logger(WebPageParser.name);

  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    const mime = String(input.mimetype ?? '').toLowerCase();
    return (
      mime === 'text/html' ||
      mime === 'application/xhtml+xml' ||
      ['.html', '.htm', '.xhtml'].includes(ext)
    );
  }

  async parse(input: ParseInput): Promise<ParseOutput> {
    const html = input.buffer.toString('utf-8');
    this.logger.log(`[WebPageParser] 开始解析 HTML 网页，长度: ${html.length}`);

    // 1. 尝试从 HTML 元数据中提取网页标题
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || '无标题网页').trim();

    // 2. 尝试提取 canonical URL
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    const ogUrlMatch = html.match(/<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i);
    const sourceUrl = canonicalMatch?.[1] || ogUrlMatch?.[1] || 's3-upload';

    // 3. 去除无用标签并提取干净的文本
    let cleanedText = html;
    cleanedText = cleanedText.replace(/<!--[\s\S]*?-->/g, ''); // 去注释
    cleanedText = cleanedText.replace(/<script[\s\S]*?<\/script>/gi, ''); // 去脚本
    cleanedText = cleanedText.replace(/<style[\s\S]*?<\/style>/gi, ''); // 去样式
    cleanedText = cleanedText.replace(/<[^>]+>/g, '\n'); // 标签换行
    
    // 合并多余换行和空格
    const lines = cleanedText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const bodyText = lines.join('\n\n');

    // 4. 构建标准化 Markdown
    const markdown = `# ${title}\n\n**原始网页链接**: ${sourceUrl}\n\n${bodyText}`;

    return {
      markdown,
      assets: [],
      metadata: {
        filename: input.filename,
        title,
        sourceUrl,
        size: input.size,
      },
    };
  }
}
