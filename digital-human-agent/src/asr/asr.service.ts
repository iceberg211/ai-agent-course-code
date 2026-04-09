import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelName: string;
  private readonly fallbackModelName: string;
  private hasWarnedModelFallback = false;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ??
      this.configService.get<string>('DASHSCOPE_API_KEY') ??
      '';
    this.baseUrl = (
      this.configService.get<string>('OPENAI_BASE_URL') ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    ).replace(/\/$/, '');
    this.modelName =
      this.configService.get<string>('ASR_MODEL') ?? 'paraformer-realtime-v2';
    this.fallbackModelName =
      this.configService.get<string>('ASR_FALLBACK_MODEL') ??
      'qwen3-asr-flash';
  }

  async recognize(audioBuffer: Buffer): Promise<string> {
    if (!this.apiKey) {
      throw new Error('ASR 配置缺失：请设置 OPENAI_API_KEY 或 DASHSCOPE_API_KEY');
    }

    try {
      return await this.recognizeWithModel(this.modelName, audioBuffer);
    } catch (err) {
      if (
        this.shouldFallbackToCompatibleModel(err) &&
        this.modelName !== this.fallbackModelName
      ) {
        if (!this.hasWarnedModelFallback) {
          this.logger.warn(
            `ASR 模型 ${this.modelName} 在兼容模式不可用，自动降级为 ${this.fallbackModelName}`,
          );
          this.hasWarnedModelFallback = true;
        }
        return this.recognizeWithModel(this.fallbackModelName, audioBuffer);
      }
      this.logger.error('ASR recognition failed', err);
      throw err;
    }
  }

  private async recognizeWithModel(
    model: string,
    audioBuffer: Buffer,
  ): Promise<string> {
    const dataUri = `data:audio/webm;base64,${audioBuffer.toString('base64')}`;
    const payload = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: dataUri,
              },
            },
          ],
        },
      ],
      stream: false,
      asr_options: {
        enable_itn: false,
      },
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`ASR HTTP ${res.status}: ${bodyText}`);
    }

    const json = JSON.parse(bodyText) as Record<string, any>;
    const text = this.extractTextFromCompatibleResponse(json);
    return text.trim();
  }

  private extractTextFromCompatibleResponse(
    json: Record<string, any>,
  ): string {
    const messageContent = json?.choices?.[0]?.message?.content;

    if (typeof messageContent === 'string') {
      return messageContent;
    }

    if (Array.isArray(messageContent)) {
      const parts = messageContent
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item?.text === 'string') return item.text;
          return '';
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join('');
    }

    if (typeof json?.text === 'string') return json.text;
    if (typeof json?.output?.text === 'string') return json.output.text;
    if (typeof json?.output?.transcription === 'string') {
      return json.output.transcription;
    }
    return '';
  }

  private shouldFallbackToCompatibleModel(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return (
      /ASR HTTP 404/i.test(message) ||
      /Unsupported model/i.test(message) ||
      /model_not_supported/i.test(message)
    );
  }
}
