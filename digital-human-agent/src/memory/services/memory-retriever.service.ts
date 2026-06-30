import { Injectable } from '@nestjs/common';
import { LongTermMemoryService } from '@/memory/services/long-term-memory.service';
import type { MemoryRecord } from '@/memory/memory.types';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class MemoryRetrieverService {
  constructor(private readonly longTermMemoryService: LongTermMemoryService) {}

  retrieve(input: {
    query: string;
    ownerId?: string | null;
    department?: string | null;
    limit?: number;
    accessScope?: KnowledgeAccessScope;
  }): Promise<MemoryRecord[]> {
    return this.longTermMemoryService.search(
      {
        ownerId: input.ownerId,
        department: input.department,
        query: input.query,
        limit: input.limit,
      },
      input.accessScope,
    );
  }
}

