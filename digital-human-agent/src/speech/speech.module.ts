import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TTS_PROVIDER_NAME } from '@/common/constants';
import { AsrService } from '@/speech/asr/asr.service';
import { TTS_PROVIDER_TOKEN } from '@/speech/tts/tts.constants';
import { DashscopeTtsProvider } from '@/speech/tts/providers/dashscope-tts.provider';
import { TtsService } from '@/speech/tts/tts.service';
import { VoiceCloneService } from '@/speech/voice-clone/voice-clone.service';
import { VoiceCloneController } from '@/speech/voice-clone/voice-clone.controller';
import { PersonaModule } from '@/persona/persona.module';

@Module({
  imports: [PersonaModule],
  controllers: [VoiceCloneController],
  providers: [
    AsrService,
    DashscopeTtsProvider,
    {
      provide: TTS_PROVIDER_TOKEN,
      inject: [ConfigService, DashscopeTtsProvider],
      useFactory: (
        configService: ConfigService,
        dashscopeProvider: DashscopeTtsProvider,
      ) => {
        const providerName = (
          configService.get<string>('TTS_PROVIDER') ?? DEFAULT_TTS_PROVIDER_NAME
        )
          .trim()
          .toLowerCase();

        switch (providerName) {
          case 'dashscope':
            return dashscopeProvider;
          default:
            throw new Error(`不支持的 TTS_PROVIDER: ${providerName}`);
        }
      },
    },
    TtsService,
    VoiceCloneService,
  ],
  exports: [AsrService, TtsService, VoiceCloneService],
})
export class SpeechModule {}
