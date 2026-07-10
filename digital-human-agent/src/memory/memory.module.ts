import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { MemoryController } from '@/memory/controllers/memory.controller';
import { MemoryRecordEntity } from '@/memory/entities/memory-record.entity';
import {
  LONG_TERM_MEMORY_PROVIDER,
} from '@/memory/memory.types';
import { LocalLongTermMemoryProvider } from '@/memory/providers/local-long-term-memory.provider';
import { Mem0LongTermMemoryProvider } from '@/memory/providers/mem0-long-term-memory.provider';
import { LongTermMemoryService } from '@/memory/services/long-term-memory.service';
import { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import { MemoryRetrieverService } from '@/memory/services/memory-retriever.service';
import { ShortTermMemoryService } from '@/memory/services/short-term-memory.service';
import { RbacModule } from '@/rbac/rbac.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([MemoryRecordEntity]),
    RbacModule,
  ],
  controllers: [MemoryController],
  providers: [
    ShortTermMemoryService,
    LongTermMemoryService,
    MemoryRetrieverService,
    MemoryPolicyService,
    LocalLongTermMemoryProvider,
    Mem0LongTermMemoryProvider,
    {
      provide: LONG_TERM_MEMORY_PROVIDER,
      inject: [
        ConfigService,
        LocalLongTermMemoryProvider,
        Mem0LongTermMemoryProvider,
      ],
      useFactory: (
        configService: ConfigService,
        localProvider: LocalLongTermMemoryProvider,
        mem0Provider: Mem0LongTermMemoryProvider,
      ) => {
        const provider = String(
          configService.get<string>('LONG_TERM_MEMORY_PROVIDER') ?? 'local',
        )
          .trim()
          .toLowerCase();
        if (provider === 'mem0' && mem0Provider.isEnabled()) {
          return mem0Provider;
        }
        return localProvider;
      },
    },
  ],
  exports: [
    ShortTermMemoryService,
    LongTermMemoryService,
    MemoryRetrieverService,
    MemoryPolicyService,
  ],
})
export class MemoryModule {}
