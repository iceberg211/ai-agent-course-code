import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmFactoryService } from '@/common/llm/llm-factory.service';
import { AccessControlService } from '@/common/security/access-control.service';
import { AccessTokenGuard } from '@/common/security/access-token.guard';
import { RedisModule } from '@/common/redis/redis.module';
import { KnowledgeCacheRevisionService } from '@/common/rag/knowledge-cache-revision.service';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    LlmFactoryService,
    AccessControlService,
    AccessTokenGuard,
    KnowledgeCacheRevisionService,
  ],
  exports: [
    LlmFactoryService,
    AccessControlService,
    AccessTokenGuard,
    KnowledgeCacheRevisionService,
    RedisModule,
  ],
})
export class CommonModule {}
