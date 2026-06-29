import { PlainTextParser } from './plain-text.parser';
import { PdfParser } from './pdf.parser';
import { OfficeParser } from './office.parser';
import { ImageOcrParser } from './image-ocr.parser';
import { AudioAsrParser } from './audio-asr.parser';
import { VideoParser } from './video.parser';
import { WebPageParser } from './web-page.parser';
import { DocumentParserService } from './document-parser.service';
import { Readable } from 'node:stream';

// Mock pdf-parse
jest.mock('pdf-parse', () => {
  return jest.fn().mockResolvedValue({ text: 'mocked pdf content' });
});

// Mock officeparser
jest.mock('officeparser', () => {
  return {
    parseUndefinedAsync: jest.fn().mockResolvedValue('mocked office content'),
  };
});

describe('DocumentParserService & Individual Parsers', () => {
  let plainTextParser: PlainTextParser;
  let pdfParser: PdfParser;
  let officeParser: OfficeParser;
  let imageOcrParser: ImageOcrParser;
  let audioAsrParser: AudioAsrParser;
  let videoParser: VideoParser;
  let webPageParser: WebPageParser;
  let parserService: DocumentParserService;

  let storageProviderMock: any;
  let configServiceMock: any;
  let llmFactoryMock: any;
  let llmMock: any;

  beforeEach(() => {
    storageProviderMock = {
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    configServiceMock = {
      get: jest.fn().mockReturnValue('test-bucket'),
    };
    llmMock = {
      invoke: jest.fn().mockResolvedValue({
        content: '===OCR===\nocr-content\n===DESCRIPTION===\ndesc-content',
      }),
    };
    llmFactoryMock = {
      createChatModel: jest.fn().mockReturnValue(llmMock),
    };

    plainTextParser = new PlainTextParser();
    pdfParser = new PdfParser();
    officeParser = new OfficeParser();
    imageOcrParser = new ImageOcrParser(
      storageProviderMock,
      configServiceMock,
      llmFactoryMock,
    );
    audioAsrParser = new AudioAsrParser(
      storageProviderMock,
      configServiceMock,
    );
    videoParser = new VideoParser(
      storageProviderMock,
      configServiceMock,
      llmFactoryMock,
    );
    webPageParser = new WebPageParser();

    parserService = new DocumentParserService(
      plainTextParser,
      pdfParser,
      officeParser,
      imageOcrParser,
      audioAsrParser,
      videoParser,
      webPageParser,
    );
  });

  describe('支持类型匹配校验 (supports)', () => {
    it('PlainTextParser 应正确匹配文本文件', () => {
      expect(plainTextParser.supports({ filename: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(plainTextParser.supports({ filename: 'b.md', mimetype: 'text/markdown', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(plainTextParser.supports({ filename: 'c.csv', mimetype: 'text/csv', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(plainTextParser.supports({ filename: 'd.json', mimetype: 'application/json', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(plainTextParser.supports({ filename: 'e.pdf', mimetype: 'application/pdf', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });

    it('PdfParser 应正确匹配 PDF 文件', () => {
      expect(pdfParser.supports({ filename: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(pdfParser.supports({ filename: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });

    it('OfficeParser 应正确匹配 Office 文件', () => {
      expect(officeParser.supports({ filename: 'a.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(officeParser.supports({ filename: 'b.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(officeParser.supports({ filename: 'c.pptx', mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(officeParser.supports({ filename: 'd.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });

    it('ImageOcrParser 应正确匹配图片文件', () => {
      expect(imageOcrParser.supports({ filename: 'a.png', mimetype: 'image/png', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(imageOcrParser.supports({ filename: 'b.jpg', mimetype: 'image/jpeg', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(imageOcrParser.supports({ filename: 'c.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });

    it('AudioAsrParser 应正确匹配音频文件', () => {
      expect(audioAsrParser.supports({ filename: 'a.mp3', mimetype: 'audio/mpeg', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(audioAsrParser.supports({ filename: 'b.wav', mimetype: 'audio/wav', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(audioAsrParser.supports({ filename: 'c.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });

    it('VideoParser 应正确匹配视频文件', () => {
      expect(videoParser.supports({ filename: 'a.mp4', mimetype: 'video/mp4', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(videoParser.supports({ filename: 'b.avi', mimetype: 'video/x-msvideo', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(videoParser.supports({ filename: 'c.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });

    it('WebPageParser 应正确匹配 HTML 网页', () => {
      expect(webPageParser.supports({ filename: 'a.html', mimetype: 'text/html', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(webPageParser.supports({ filename: 'b.htm', mimetype: 'text/html', buffer: Buffer.from(''), size: 0 })).toBe(true);
      expect(webPageParser.supports({ filename: 'c.txt', mimetype: 'text/plain', buffer: Buffer.from(''), size: 0 })).toBe(false);
    });
  });

  describe('解析功能校验 (parse)', () => {
    it('PlainTextParser 应直接返回文本内容', async () => {
      const output = await plainTextParser.parse({ filename: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from('hello plain text'), size: 16 });
      expect(output.markdown).toBe('hello plain text');
      expect(output.assets).toHaveLength(0);
    });

    it('PdfParser 应提取 PDF 文本', async () => {
      const output = await pdfParser.parse({ filename: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('pdf-data'), size: 8 });
      expect(output.markdown).toBe('mocked pdf content');
      expect(output.assets).toHaveLength(0);
    });

    it('OfficeParser 应提取 Office 文本', async () => {
      const output = await officeParser.parse({ filename: 'a.docx', mimetype: 'application/docx', buffer: Buffer.from('docx-data'), size: 9 });
      expect(output.markdown).toBe('mocked office content');
      expect(output.assets).toHaveLength(0);
    });

    it('ImageOcrParser 应上传图片并调用 LLM OCR 提取文本和描述', async () => {
      const output = await imageOcrParser.parse(
        { filename: 'img.png', mimetype: 'image/png', buffer: Buffer.from('img-data'), size: 8 },
        { knowledgeBaseId: 'kb-1', ingestRunId: 'run-1' },
      );

      expect(storageProviderMock.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'test-bucket',
          contentType: 'image/png',
        }),
      );
      expect(llmMock.invoke).toHaveBeenCalled();
      expect(output.markdown).toContain('ocr-content');
      expect(output.markdown).toContain('desc-content');
      expect(output.assets).toHaveLength(1);
      expect(output.assets[0].ocrText).toBe('ocr-content');
      expect(output.assets[0].caption).toBe('desc-content');
    });

    it('WebPageParser 应干净地滤除 HTML 标签并保留正文与 URL', async () => {
      const htmlStr = '<html><head><title>Test Page</title><link rel="canonical" href="https://example.com/test"/></head><body><h1>Hello World</h1><script>console.log(1)</script><p>This is a paragraph.</p></body></html>';
      const output = await webPageParser.parse({ filename: 'web.html', mimetype: 'text/html', buffer: Buffer.from(htmlStr), size: htmlStr.length });
      
      expect(output.markdown).toContain('Hello World');
      expect(output.markdown).toContain('This is a paragraph.');
      expect(output.markdown).not.toContain('console.log'); // 标签和 script 应该被过滤掉
      expect(output.markdown).toContain('https://example.com/test');
    });
  });

  describe('DocumentParserService 门面路由校验', () => {
    it('对于 pdf 输入，应自动调度 PdfParser 执行解析', async () => {
      const output = await parserService.parse(
        { filename: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('pdf'), size: 3 },
        { knowledgeBaseId: 'kb-1', ingestRunId: 'run-1' },
      );
      expect(output.markdown).toBe('mocked pdf content');
    });

    it('不支持的文件类型应抛出 BadRequestException', async () => {
      await expect(
        parserService.parse(
          { filename: 'doc.exe', mimetype: 'application/octet-stream', buffer: Buffer.from(''), size: 0 },
          { knowledgeBaseId: 'kb-1', ingestRunId: 'run-1' },
        ),
      ).rejects.toThrow();
    });
  });
});
