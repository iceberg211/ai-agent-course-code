import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PlainTextParser } from './plain-text.parser';
import { PdfParser } from './pdf.parser';
import { OfficeParser } from './office.parser';
import { ImageOcrParser } from './image-ocr.parser';
import { AudioAsrParser } from './audio-asr.parser';
import { VideoParser } from './video.parser';
import { WebPageParser } from './web-page.parser';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
} from './parser.interface';

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);
  private readonly parsers: DocumentParserProvider[];

  constructor(
    private readonly plainTextParser: PlainTextParser,
    private readonly pdfParser: PdfParser,
    private readonly officeParser: OfficeParser,
    private readonly imageOcrParser: ImageOcrParser,
    private readonly audioAsrParser: AudioAsrParser,
    private readonly videoParser: VideoParser,
    private readonly webPageParser: WebPageParser,
  ) {
    // 注册优先级：顺序敏感
    this.parsers = [
      this.plainTextParser,
      this.pdfParser,
      this.officeParser,
      this.imageOcrParser,
      this.audioAsrParser,
      this.videoParser,
      this.webPageParser,
    ];
  }

  async parse(
    input: ParseInput,
    context: { knowledgeBaseId: string; ingestRunId: string },
  ): Promise<ParseOutput> {
    this.logger.log(
      `正在匹配解析器: filename=${input.filename} size=${input.size} mimetype=${input.mimetype}`,
    );

    for (const parser of this.parsers) {
      if (parser.supports(input)) {
        this.logger.log(`匹配到解析器: ${parser.constructor.name}`);
        return parser.parse(input, context);
      }
    }

    this.logger.error(`无法匹配任何解析器: filename=${input.filename} mimetype=${input.mimetype}`);
    throw new BadRequestException(`不支持的文件类型，无法解析: ${input.filename}`);
  }
}
