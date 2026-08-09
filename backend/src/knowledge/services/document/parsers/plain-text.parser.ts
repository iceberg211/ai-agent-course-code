import { Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
} from './parser.interface';

@Injectable()
export class PlainTextParser implements DocumentParserProvider {
  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    const mime = String(input.mimetype ?? '').toLowerCase();
    return (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      ['.txt', '.md', '.csv', '.json'].includes(ext)
    );
  }

  async parse(input: ParseInput): Promise<ParseOutput> {
    const content = input.buffer.toString('utf-8').trim();
    return {
      markdown: content,
      assets: [],
      metadata: {
        filename: input.filename,
        size: input.size,
        mimetype: input.mimetype,
      },
    };
  }
}
