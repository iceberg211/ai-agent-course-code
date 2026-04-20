import { Module } from '@nestjs/common';
import { TtsService } from '@/tts/tts.service';

@Module({
  providers: [TtsService],
  exports: [TtsService],
})
export class TtsModule {}
