import {
  Injectable, InternalServerErrorException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelName: string;
  private readonly defaultVoice: string;

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
      this.configService.get<string>('TTS_MODEL') ?? 'cosyvoice-v1';
    this.defaultVoice =
      this.configService.get<string>('TTS_DEFAULT_VOICE') ?? 'longxiaochun';
  }

  /**
   * 流式合成语音。
   * @param text       要合成的文字（一个完整句子）
   * @param voiceId    克隆声音 ID（没有则用默认）
   * @param signal     AbortSignal，abort 时停止请求
   * @param onChunk    每收到一帧音频数据时的回调（Buffer）
   */
  async synthesizeStream(
    text: string,
    voiceId: string | null,
    signal: AbortSignal,
    onChunk: (pcm: Buffer) => void,
  ): Promise<void> {
    if (signal.aborted || !text.trim()) return;
    this.ensureConfigReady();

    const voice = this.resolveVoice(voiceId);
    this.logger.log(
      `[TTS] synthesize start model=${this.modelName}, voice=${voice}, text="${text.slice(0, 30)}..."`,
    );

    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        model: this.modelName,
        input: text,
        voice,
        response_format: 'mp3',
      }),
      signal,
    });

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(`TTS HTTP ${res.status}: ${bodyText}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as Record<string, any>;
      const base64Audio =
        (typeof data.audio === 'string' && data.audio) ||
        (typeof data?.output?.audio === 'string' && data.output.audio) ||
        (typeof data?.data?.audio === 'string' && data.data.audio) ||
        '';
      if (base64Audio) {
        onChunk(Buffer.from(base64Audio, 'base64'));
      }
      return;
    }

    if (!res.body) {
      const whole = Buffer.from(await res.arrayBuffer());
      if (whole.length > 0) onChunk(whole);
      return;
    }

    const reader = res.body.getReader();
    try {
      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          onChunk(Buffer.from(value));
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private resolveVoice(voiceId: string | null): string {
    if (!voiceId) return this.defaultVoice;
    return voiceId.trim() || this.defaultVoice;
  }

  private ensureConfigReady() {
    if (!this.apiKey || !this.baseUrl) {
      throw new InternalServerErrorException(
        'TTS 配置缺失：请设置 OPENAI_API_KEY（或 DASHSCOPE_API_KEY）和 OPENAI_BASE_URL',
      );
    }
  }
}
