import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AsrClient = require('tencentcloud-sdk-nodejs-asr').asr.v20190614.Client;

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);
  private readonly client: any;

  constructor() {
    this.client = new AsrClient({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID,
        secretKey: process.env.TENCENT_SECRET_KEY,
      },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } },
    });
  }

  async recognize(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const base64Audio = audioBuffer.toString('base64');
    try {
      const result = await this.client.SentenceRecognition({
        ProjectId: 0,
        SubServiceType: 2,
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'mp3',
        UsrAudioKey: `audio_${Date.now()}`,
        Data: base64Audio,
        DataLen: audioBuffer.length,
      });
      return result.Result ?? '';
    } catch (err) {
      this.logger.error('ASR recognition failed', err);
      throw err;
    }
  }
}
