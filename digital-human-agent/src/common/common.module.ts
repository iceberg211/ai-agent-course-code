import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';
import { AccessControlService } from '@/common/security/access-control.service';
import { AccessTokenGuard } from '@/common/security/access-token.guard';

@Module({
  imports: [ConfigModule],
  providers: [LlmFactoryService, AccessControlService, AccessTokenGuard],
  exports: [LlmFactoryService, AccessControlService, AccessTokenGuard],
})
export class CommonModule {}
