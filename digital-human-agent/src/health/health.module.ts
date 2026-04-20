import { Module } from '@nestjs/common';
import { DigitalHumanModule } from '@/digital-human/digital-human.module';
import { HealthController } from '@/health/health.controller';
import { HealthService } from '@/health/health.service';

@Module({
  imports: [DigitalHumanModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

