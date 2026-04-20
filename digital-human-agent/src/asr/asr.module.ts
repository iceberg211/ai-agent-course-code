import { Module } from '@nestjs/common';
import { AsrService } from '@/asr/asr.service';

@Module({
  providers: [AsrService],
  exports: [AsrService],
})
export class AsrModule {}
