import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_DIGITAL_HUMAN_PROVIDER,
  DIGITAL_HUMAN_PROVIDER,
  DIGITAL_HUMAN_PROVIDER_NAME,
} from '@/common/constants';
import { MockDigitalHumanProvider } from '@/digital-human/providers/mock-digital-human.provider';
import { SimliProvider } from '@/digital-human/providers/simli.provider';

@Module({
  providers: [
    MockDigitalHumanProvider,
    SimliProvider,
    {
      provide: DIGITAL_HUMAN_PROVIDER,
      inject: [ConfigService, MockDigitalHumanProvider, SimliProvider],
      useFactory: (
        configService: ConfigService,
        mockProvider: MockDigitalHumanProvider,
        simliProvider: SimliProvider,
      ) => {
        const providerName = (
          configService.get<string>('DIGITAL_HUMAN_PROVIDER') ??
          DEFAULT_DIGITAL_HUMAN_PROVIDER
        )
          .trim()
          .toLowerCase();
        if (providerName === DIGITAL_HUMAN_PROVIDER_NAME.simli) {
          return simliProvider;
        }
        return mockProvider;
      },
    },
  ],
  exports: [DIGITAL_HUMAN_PROVIDER],
})
export class DigitalHumanModule {}
