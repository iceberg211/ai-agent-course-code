import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DIGITAL_HUMAN_PROVIDER } from './digital-human.constants';
import { MockDigitalHumanProvider } from './providers/mock-digital-human.provider';
import { SimliProvider } from './providers/simli.provider';

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
          configService.get<string>('DIGITAL_HUMAN_PROVIDER') ?? 'mock'
        )
          .trim()
          .toLowerCase();
        if (providerName === 'simli') {
          return simliProvider;
        }
        return mockProvider;
      },
    },
  ],
  exports: [DIGITAL_HUMAN_PROVIDER],
})
export class DigitalHumanModule {}
