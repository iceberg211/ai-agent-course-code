import { Module } from '@nestjs/common';
import { DigitalHumanModule } from '@/digital-human/digital-human.module';
import { QueueModule } from '@/queue/queue.module';
import { KnowledgeModule } from '@/knowledge/knowledge.module';
import { StorageModule } from '@/storage/storage.module';
import { HealthController } from '@/health/health.controller';
import { HealthService } from '@/health/health.service';

@Module({
  imports: [DigitalHumanModule, QueueModule, KnowledgeModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
