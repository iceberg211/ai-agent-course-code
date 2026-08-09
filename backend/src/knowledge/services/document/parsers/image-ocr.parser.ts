import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
} from './parser.interface';

@Injectable()
export class ImageOcrParser implements DocumentParserProvider {
  private readonly logger = new Logger(ImageOcrParser.name);
  private readonly llm: ChatOpenAI;

  constructor(
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider: ObjectStorageProvider,
    private readonly configService: ConfigService,
    private readonly llmFactory: LlmFactoryService,
  ) {
    this.llm = this.llmFactory.createChatModel({
      temperature: 0,
    });
  }

  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    const mime = String(input.mimetype ?? '').toLowerCase();
    return (
      mime.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(ext)
    );
  }

  async parse(
    input: ParseInput,
    context: { knowledgeBaseId: string; ingestRunId: string },
  ): Promise<ParseOutput> {
    const { knowledgeBaseId, ingestRunId } = context;
    const bucket = this.configService.get<string>('S3_BUCKET') || 'enterprise-kb';
    const uuid = randomUUID();
    const storageKey = `knowledge-bases/${knowledgeBaseId}/assets/${ingestRunId}/${uuid}-${input.filename}`;

    this.logger.log(`[ImageParser] 上传图片资产至 S3: ${storageKey}`);
    
    // 1. 上传图片到 S3 对象存储
    await this.storageProvider.putObject({
      bucket,
      key: storageKey,
      body: input.buffer,
      contentType: input.mimetype,
    });

    // 2. 将图片转换为 Base64，调用多模态大模型进行 OCR 和描述
    const base64Image = input.buffer.toString('base64');
    let ocrText = '';
    let caption = '';

    try {
      this.logger.log(`[ImageParser] 调用多模态模型提取图片 OCR 与描述...`);
      const response = await this.llm.invoke([
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: '请帮我完成两件事：\n1. 提取这张图片里的所有文字（OCR）。\n2. 描述这张图片里的场景、内容、图表或人物。\n\n请严格按照如下的格式返回，不要附带任何前言或后记：\n\n===OCR===\n[提取的文字内容]\n\n===DESCRIPTION===\n[图片的描述内容]',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${input.mimetype};base64,${base64Image}`,
              },
            },
          ],
        }),
      ]);

      const resText = String(response.content);
      const ocrMatch = resText.match(/===OCR===([\s\S]*?)(===DESCRIPTION===|$)/);
      const descMatch = resText.match(/===DESCRIPTION===([\s\S]*?)$/);

      ocrText = (ocrMatch?.[1] || '').trim();
      caption = (descMatch?.[1] || '').trim();

      if (!ocrText && !caption) {
        // 降级：如果模型没有按照格式返回，将整个输出同时作为 ocrText 和 caption
        ocrText = resText.trim();
        caption = resText.trim();
      }
    } catch (err) {
      this.logger.warn(`[ImageParser] 大模型 OCR / 描述生成失败，降级为空文本: ${err.message}`);
      ocrText = '图片解析失败';
      caption = '图片描述失败';
    }

    // 3. 生成 Markdown 输出
    const markdown = `![${input.filename}](s3://${bucket}/${storageKey})

**OCR 识别文本**：
${ocrText || '无识别文本'}

**图片内容描述**：
${caption || '无图片内容描述'}`;

    return {
      markdown,
      assets: [
        {
          assetType: 'image',
          filename: input.filename,
          mimeType: input.mimetype,
          storageKey,
          caption,
          ocrText,
          metadata: {
            size: input.size,
          },
        },
      ],
      metadata: {
        storageKey,
        ocrLength: ocrText.length,
        descLength: caption.length,
      },
    };
  }
}
