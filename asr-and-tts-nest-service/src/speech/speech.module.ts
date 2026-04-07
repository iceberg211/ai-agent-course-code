import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechService } from './speech.service';
import { SpeechController } from './speech.controller';
import { SpeechGateway } from './speech.gateway';
import { AiModule } from '../ai/ai.module';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';

const AsrClient = tencentcloud.asr.v20190614.Client;

@Module({
  imports: [AiModule], // SpeechGateway 依赖 AiService
  providers: [
    SpeechService,
    SpeechGateway,
    {
      provide: 'ASR_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new AsrClient({
          credential: {
            secretId: configService.get<string>('SECRET_ID'),
            secretKey: configService.get<string>('SECRET_KEY'),
          },
          region: 'ap-shanghai',
          profile: {
            httpProfile: { reqMethod: 'POST', reqTimeout: 30 },
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  controllers: [SpeechController],
})
export class SpeechModule {}
