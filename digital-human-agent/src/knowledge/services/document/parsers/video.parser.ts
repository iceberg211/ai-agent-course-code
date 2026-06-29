import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';
import {
  DocumentParserProvider,
  ParseInput,
  ParseOutput,
  ParsedAsset,
} from './parser.interface';

const execFileAsync = promisify(execFile);

@Injectable()
export class VideoParser implements DocumentParserProvider {
  private readonly logger = new Logger(VideoParser.name);
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

    // 2. 优先提取音频转写文本，用于文本检索和问答引用。
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

    // 3. 可选抽取关键帧。没有 ffmpeg 时不阻断入库。
    const frameAssets = await this.extractAndAnalyzeFrames({
      input,
      bucket,
      storageKey,
      knowledgeBaseId,
      ingestRunId,
      uuid,
    });

    // 4. 构建 Markdown 及 Assets
    const parsedAssets: ParsedAsset[] = [];
    let markdown = `# 视频转写文本: ${input.filename}\n\n`;

    if (frameAssets.length > 0) {
      markdown += `## 关键帧解析\n\n`;
      for (const asset of frameAssets) {
        markdown += `![${asset.filename}](s3://${bucket}/${asset.storageKey})\n\n`;
        markdown += `**关键帧 OCR**：\n${asset.ocrText || '无识别文本'}\n\n`;
        markdown += `**关键帧描述**：\n${asset.caption || '无图片内容描述'}\n\n`;
      }
    } else {
      markdown += `> [!NOTE]\n`;
      markdown += `> 当前运行环境未完成视频关键帧提取，已自动降级为音频 ASR 内容入库。\n\n`;
    }

    if (segments.length > 0) {
      markdown += `## 音频转写\n\n`;
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

    parsedAssets.push(...frameAssets);

    return {
      markdown,
      assets: parsedAssets,
      metadata: {
        storageKey,
        segmentCount: segments.length,
        keyframeCount: frameAssets.length,
        ffmpegAvailable: frameAssets.length > 0,
      },
    };
  }

  private async extractAndAnalyzeFrames(params: {
    input: ParseInput;
    bucket: string;
    storageKey: string;
    knowledgeBaseId: string;
    ingestRunId: string;
    uuid: string;
  }): Promise<ParsedAsset[]> {
    const { input, bucket, knowledgeBaseId, ingestRunId, uuid } = params;
    let tempDir: string | null = null;

    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 3_000 });
      tempDir = await mkdtemp(join(tmpdir(), 'kb-video-'));
      const inputPath = join(tempDir, `input${extname(input.filename) || '.mp4'}`);
      const outputPattern = join(tempDir, 'frame-%03d.jpg');

      await writeFile(inputPath, input.buffer);
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          inputPath,
          '-vf',
          'fps=1/30',
          '-frames:v',
          '3',
          outputPattern,
        ],
        { timeout: 60_000 },
      );

      const filenames = (await readdir(tempDir))
        .filter((name) => /^frame-\d+\.jpg$/.test(name))
        .sort();
      const assets: ParsedAsset[] = [];

      for (const [index, frameFilename] of filenames.entries()) {
        const frameBuffer = await readFile(join(tempDir, frameFilename));
        const frameStorageKey = `knowledge-bases/${knowledgeBaseId}/assets/${ingestRunId}/${uuid}-${frameFilename}`;

        await this.storageProvider.putObject({
          bucket,
          key: frameStorageKey,
          body: frameBuffer,
          contentType: 'image/jpeg',
        });

        const analysis = await this.analyzeFrame(frameBuffer);
        assets.push({
          assetType: 'image',
          filename: `${input.filename}-${frameFilename}`,
          mimeType: 'image/jpeg',
          storageKey: frameStorageKey,
          startMs: index * 30_000,
          endMs: index * 30_000,
          caption: analysis.caption,
          ocrText: analysis.ocrText,
          metadata: {
            sourceVideoStorageKey: params.storageKey,
            frameIndex: index + 1,
          },
        });
      }

      return assets;
    } catch (err) {
      this.logger.warn(`[VideoParser] 视频关键帧提取失败，降级为 ASR 内容: ${err.message}`);
      return [];
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }

  private async analyzeFrame(
    frameBuffer: Buffer,
  ): Promise<{ ocrText: string; caption: string }> {
    try {
      const base64Image = frameBuffer.toString('base64');
      const response = await this.llm.invoke([
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: '请帮我完成两件事：\n1. 提取这张视频关键帧里的所有文字（OCR）。\n2. 描述这张关键帧中的场景、对象、图表或人物。\n\n请严格按照如下格式返回，不要附带前言或后记：\n\n===OCR===\n[提取的文字内容]\n\n===DESCRIPTION===\n[图片的描述内容]',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        }),
      ]);

      const resText = String(response.content);
      const ocrMatch = resText.match(/===OCR===([\s\S]*?)(===DESCRIPTION===|$)/);
      const descMatch = resText.match(/===DESCRIPTION===([\s\S]*?)$/);
      const ocrText = (ocrMatch?.[1] || '').trim();
      const caption = (descMatch?.[1] || '').trim();

      if (!ocrText && !caption) {
        const fallback = resText.trim();
        return { ocrText: fallback, caption: fallback };
      }

      return { ocrText, caption };
    } catch (err) {
      this.logger.warn(`[VideoParser] 关键帧 OCR / 描述生成失败: ${err.message}`);
      return {
        ocrText: '关键帧解析失败',
        caption: '关键帧描述失败',
      };
    }
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
