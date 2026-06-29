import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
  ParsedAsset,
} from './parser.interface';

@Injectable()
export class AudioAsrParser implements DocumentParserProvider {
  private readonly logger = new Logger(AudioAsrParser.name);

  constructor(
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider: ObjectStorageProvider,
    private readonly configService: ConfigService,
  ) {}

  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    const mime = String(input.mimetype ?? '').toLowerCase();
    return (
      mime.startsWith('audio/') ||
      ['.mp3', '.wav', '.mpeg', '.ogg', '.m4a', '.flac'].includes(ext)
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

    this.logger.log(`[AudioParser] 上传音频资产至 S3: ${storageKey}`);

    // 1. 上传音频到 S3
    await this.storageProvider.putObject({
      bucket,
      key: storageKey,
      body: input.buffer,
      contentType: input.mimetype,
    });

    // 2. 调用 Whisper API 转写音频
    let transcriptText = '';
    let segments: Array<{ start: number; end: number; text: string }> = [];

    let baseURL =
      this.configService.get<string>('OPENAI_BASE_URL') ||
      'https://api.openai.com/v1';
    baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const whisperUrl = `${baseURL}/audio/transcriptions`;
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(`[AudioParser] OPENAI_API_KEY 丢失，无法调用 ASR`);
      transcriptText = '[音频未转写，API Key 丢失]';
    } else {
      try {
        this.logger.log(`[AudioParser] 正在发送音频至 ASR 转写服务: ${whisperUrl}`);
        
        // 使用原生 FormData 和 Blob，免去第三方依赖
        const formData = new FormData();
        const fileBlob = new Blob([input.buffer], { type: input.mimetype });
        formData.append('file', fileBlob, input.filename);
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');

        const res = await fetch(whisperUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`ASR 服务返回失败 (${res.status}): ${errText}`);
        }

        const data = (await res.json()) as any;
        transcriptText = String(data.text ?? '').trim();
        segments = (data.segments || []).map((seg: any) => ({
          start: Number(seg.start ?? 0),
          end: Number(seg.end ?? 0),
          text: String(seg.text ?? '').trim(),
        }));

        this.logger.log(`[AudioParser] 音频转写成功，长度: ${transcriptText.length}`);
      } catch (err) {
        this.logger.error(`[AudioParser] ASR 音频转写失败: ${err.message}`, err.stack);
        // 降级：仅写入空提示而不断开主流程
        transcriptText = `[音频转写失败: ${err.message}]`;
      }
    }

    // 3. 构建 Markdown 及 Assets
    const parsedAssets: ParsedAsset[] = [];
    let markdown = `# 音频转写文本: ${input.filename}\n\n`;

    if (segments.length > 0) {
      for (const seg of segments) {
        const startMs = Math.round(seg.start * 1000);
        const endMs = Math.round(seg.end * 1000);
        const timeTag = `[${formatTime(seg.start)} - ${formatTime(seg.end)}]`;
        
        markdown += `* ${timeTag} ${seg.text}\n`;

        parsedAssets.push({
          assetType: 'audio',
          filename: input.filename,
          mimeType: input.mimetype,
          storageKey,
          startMs,
          endMs,
          caption: seg.text,
          metadata: {
            timeTag,
          },
        });
      }
    } else {
      markdown += transcriptText;
      parsedAssets.push({
        assetType: 'audio',
        filename: input.filename,
        mimeType: input.mimetype,
        storageKey,
        startMs: 0,
        endMs: 0,
        caption: transcriptText,
      });
    }

    return {
      markdown,
      assets: parsedAssets,
      metadata: {
        storageKey,
        segmentCount: segments.length,
      },
    };
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
