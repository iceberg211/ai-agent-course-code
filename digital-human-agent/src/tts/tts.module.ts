import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TTS_PROVIDER_NAME } from '@/common/constants';
import { TTS_PROVIDER_TOKEN } from '@/tts/tts.constants';
import { DashscopeTtsProvider } from '@/tts/providers/dashscope-tts.provider';
import { TtsService } from '@/tts/tts.service';

@Module({
  providers: [
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
  ],
  exports: [TtsService],
})
export class TtsModule {}
