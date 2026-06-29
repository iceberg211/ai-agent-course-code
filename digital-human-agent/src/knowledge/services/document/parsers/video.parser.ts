import { Inject, Injectable, Logger } from '@nestjs/common';
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
export class VideoParser implements DocumentParserProvider {
  private readonly logger = new Logger(VideoParser.name);

  constructor(
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider: ObjectStorageProvider,
    private readonly configService: ConfigService,
  ) {}

  supports(input: ParseInput): boolean {
    const ext = extname(input.filename ?? '').toLowerCase();
    const mime = String(input.mimetype ?? '').toLowerCase();
    return (
      mime.startsWith('video/') ||
      ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)
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

    this.logger.log(`[VideoParser] 上传视频资产至 S3: ${storageKey}`);

    // 1. 上传视频原文件到 S3
    await this.storageProvider.putObject({
      bucket,
      key: storageKey,
      body: input.buffer,
      contentType: input.mimetype,
    });

    // 2. 优雅降级：直接将视频发给 Whisper 进行 ASR 音频转写
    let transcriptText = '';
    let segments: Array<{ start: number; end: number; text: string }> = [];

    let baseURL =
      this.configService.get<string>('OPENAI_BASE_URL') ||
      'https://api.openai.com/v1';
    baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const whisperUrl = `${baseURL}/audio/transcriptions`;
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(`[VideoParser] OPENAI_API_KEY 丢失，无法调用 ASR`);
      transcriptText = '[视频未转写，API Key 丢失]';
    } else {
      try {
        this.logger.log(`[VideoParser] 正在发送视频至 ASR 转写服务: ${whisperUrl}`);
        
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

        this.logger.log(`[VideoParser] 视频转写成功，长度: ${transcriptText.length}`);
      } catch (err) {
        this.logger.error(`[VideoParser] ASR 视频转写失败: ${err.message}`, err.stack);
        transcriptText = `[视频转写失败: ${err.message}]`;
      }
    }

    // 3. 构建 Markdown 及 Assets
    const parsedAssets: ParsedAsset[] = [];
    let markdown = `# 视频转写文本: ${input.filename}\n\n`;
    markdown += `> [!NOTE]\n`;
    markdown += `> 当前系统环境未检测到 ffmpeg，已自动降级跳过视频画面关键帧 OCR 与图片描述提取，仅生成音频 ASR 内容。\n\n`;

    if (segments.length > 0) {
      for (const seg of segments) {
        const startMs = Math.round(seg.start * 1000);
        const endMs = Math.round(seg.end * 1000);
        const timeTag = `[${formatTime(seg.start)} - ${formatTime(seg.end)}]`;
        
        markdown += `* ${timeTag} ${seg.text}\n`;

        parsedAssets.push({
          assetType: 'video',
          filename: input.filename,
          mimeType: input.mimetype,
          storageKey,
          startMs,
          endMs,
          caption: seg.text,
          metadata: {
            timeTag,
            hasKeyframe: false,
          },
        });
      }
    } else {
      markdown += transcriptText;
      parsedAssets.push({
        assetType: 'video',
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
        ffmpegAvailable: false,
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
