import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';

@Module({
  imports: [ConfigModule],
  providers: [LlmFactoryService],
  exports: [LlmFactoryService],
})
export class CommonModule {}
