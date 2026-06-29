import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { extname } from 'node:path';
const officeParser = require('officeparser');
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
} from './parser.interface';

@Injectable()
export class OfficeParser implements DocumentParserProvider {
  private readonly logger = new Logger(OfficeParser.name);

  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    return ['.docx', '.xlsx', '.pptx'].includes(ext);
  }

  async parse(input: ParseInput): Promise<ParseOutput> {
    this.logger.log(`开始使用 officeparser 解析 Office 文件: ${input.filename}`);
    try {
      if (typeof officeParser.parseUndefinedAsync === 'function') {
        const parsedText = await officeParser.parseUndefinedAsync(input.buffer);
        return this.toOutput(input, parsedText);
      }

      const parseOffice =
        officeParser.parseOffice ??
        officeParser.default?.parseOffice ??
        officeParser.OfficeParser?.parseOffice;
      if (typeof parseOffice !== 'function') {
        throw new Error('officeparser 未提供可用的解析方法');
      }

      const ast = await parseOffice(input.buffer, {
        includeRawContent: false,
      });
      const parsedText =
        typeof ast.toText === 'function'
          ? ast.toText()
          : JSON.stringify(ast.content ?? '');
      return this.toOutput(input, parsedText);
    } catch (err) {
      this.logger.error(`解析 Office 文件失败: ${err.message}`, err.stack);
      throw new BadRequestException(`Office 解析失败: ${err.message}`);
    }
  }

  private toOutput(input: ParseInput, parsedText: unknown): ParseOutput {
    const text = String(parsedText ?? '').trim();
    if (!text) {
      throw new BadRequestException('Office 文件未解析到可用文本');
    }

    return {
      markdown: text,
      assets: [],
      metadata: {
        filename: input.filename,
        size: input.size,
        mimetype: input.mimetype,
      },
    };
  }
}
