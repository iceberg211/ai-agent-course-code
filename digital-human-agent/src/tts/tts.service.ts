import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

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
    // 腾讯云 TTS WebSocket v2 流式合成
    // 这里提供骨架实现；完整实现参考 asr-and-tts-nest-service/tencent-tts-session.ts
    // 课程中会对照现有代码讲解
    return new Promise((resolve, reject) => {
      if (signal.aborted) return resolve();

      // 骨架：实际项目中接入腾讯云 TTS WSv2 API
      // 参数：voiceType（克隆声音 ID 或默认音色）、text、SampleRate=16000
      this.logger.log(`[TTS] synthesize: "${text.slice(0, 20)}..." voiceId=${voiceId}`);

      signal.addEventListener('abort', () => resolve(), { once: true });

      // TODO: 实际调用腾讯云 TTS WSv2，逐帧回调 onChunk(buffer)
      // 示意：模拟立即完成（集成时替换）
      resolve();
    });
  }
}
