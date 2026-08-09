import { Injectable, BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
} from './parser.interface';

@Injectable()
export class PdfParser implements DocumentParserProvider {
  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    const mime = String(input.mimetype ?? '').toLowerCase();
    return ext === '.pdf' || mime === 'application/pdf';
  }

  async parse(input: ParseInput): Promise<ParseOutput> {
    let parsedText = '';
    try {
      const pdf = require('pdf-parse');
      const data = await pdf(input.buffer);
      parsedText = String(data?.text ?? '').trim();
    } catch (err) {
      throw new BadRequestException(`PDF 解析失败: ${err.message}`);
    }

    if (!parsedText) {
      throw new BadRequestException('PDF 未解析到可用文本');
    }

    return {
      markdown: parsedText,
      assets: [],
      metadata: {
        filename: input.filename,
        size: input.size,
        mimetype: input.mimetype,
      },
    };
  }
}
