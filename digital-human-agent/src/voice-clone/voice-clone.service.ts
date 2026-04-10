import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PersonaService } from '../persona/persona.service';
import { VoiceCloneState } from './voice-clone.types';

@Injectable()
export class VoiceCloneService {
  private readonly logger = new Logger(VoiceCloneService.name);
  private readonly tasks = new Map<string, VoiceCloneState>();
  private readonly mockDelayMs: number;

  constructor(
    private readonly personaService: PersonaService,
    private readonly configService: ConfigService,
  ) {
    this.mockDelayMs = Math.max(
      Number(this.configService.get('VOICE_CLONE_MOCK_DELAY_MS') ?? 8000),
      1000,
    );
  }

  async createVoice(
    personaId: string,
    file: Express.Multer.File,
  ): Promise<VoiceCloneState> {
    this.assertSampleFile(file);
    await this.personaService.findOne(personaId);

    const state: VoiceCloneState = {
      personaId,
      status: 'training',
      voiceId: null,
      providerTaskId: randomUUID(),
      sampleFilename: file.originalname ?? 'sample.wav',
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(personaId, state);

    // 当前版本先提供可运行的 mock 训练流，避免被厂商接口阻塞。
    // 后续只需替换 runMockTraining 为真实厂商调用并在完成时回写 voiceId。
    void this.runMockTraining(personaId);

    return { ...state };
  }

  async getStatus(personaId: string): Promise<VoiceCloneState> {
    await this.personaService.findOne(personaId);

    const current = this.tasks.get(personaId);
    if (current) {
      return { ...current };
    }

    const persona = await this.personaService.findOne(personaId);
    if (persona.voiceId) {
      return {
        personaId,
        status: 'ready',
        voiceId: persona.voiceId,
        providerTaskId: null,
        sampleFilename: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      personaId,
      status: 'not_started',
      voiceId: null,
      providerTaskId: null,
      sampleFilename: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private assertSampleFile(file: Express.Multer.File) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('缺少语音样本文件');
    }

    const ext = extname(file.originalname ?? '').toLowerCase();
    const mime = String(file.mimetype ?? '').toLowerCase();
    const okExt = new Set(['.wav', '.mp3', '.m4a', '.aac']);
    const okMime = /audio\/(wav|x-wav|mpeg|mp3|mp4|aac|x-m4a)/i.test(mime);

    if (!okExt.has(ext) && !okMime) {
      throw new BadRequestException('仅支持 wav/mp3/m4a/aac 语音样本');
    }
  }

  private async runMockTraining(personaId: string) {
    await new Promise((resolve) => setTimeout(resolve, this.mockDelayMs));

    const current = this.tasks.get(personaId);
    if (!current || current.status !== 'training') {
      return;
    }

    try {
      const voiceId = `clone-${personaId.slice(0, 8)}-${Date.now().toString(36)}`;
      await this.personaService.update(personaId, { voiceId });

      const next: VoiceCloneState = {
        ...current,
        status: 'ready',
        voiceId,
        updatedAt: new Date().toISOString(),
      };
      this.tasks.set(personaId, next);
      this.logger.log(`语音克隆完成: persona=${personaId}, voiceId=${voiceId}`);
    } catch (error) {
      const next: VoiceCloneState = {
        ...current,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        errorMessage:
          error instanceof Error ? error.message : String(error ?? ''),
      };
      this.tasks.set(personaId, next);
      this.logger.error(
        `语音克隆失败: persona=${personaId}, err=${next.errorMessage}`,
      );
    }
  }
}
