import { Inject, Injectable } from '@nestjs/common';
import { TTS_PROVIDER_TOKEN } from '@/tts/tts.constants';
import { TtsOutputFormat } from '@/tts/tts.types';
import type { TtsProvider } from '@/tts/tts.types';

@Injectable()
export class TtsService {
  constructor(
    @Inject(TTS_PROVIDER_TOKEN)
    private readonly provider: TtsProvider,
  ) {}

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
    onChunk: (chunk: Buffer) => void,
    outputFormat: TtsOutputFormat = 'mp3',
  ): Promise<void> {
    await this.provider.synthesizeStream({
      text,
      voiceId,
      signal,
      onChunk,
      outputFormat,
    });
  }
}
