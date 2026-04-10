import { Module } from '@nestjs/common';
import { DigitalHumanService } from './digital-human.service';

@Module({
  providers: [DigitalHumanService],
  exports: [DigitalHumanService],
})
export class DigitalHumanModule {}
