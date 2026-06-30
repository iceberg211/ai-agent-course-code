import { Inject, Injectable, Logger } from '@nestjs/common';
import { LONG_TERM_MEMORY_PROVIDER } from '@/memory/memory.types';
import type {
  AddMemoryInput,
  DeleteMemoryInput,
  LongTermMemoryProvider,
  MemoryRecord,
  SearchMemoryInput,
} from '@/memory/memory.types';
import { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class LongTermMemoryService {
  private readonly logger = new Logger(LongTermMemoryService.name);
  private failureCount = 0;
  private circuitOpenUntil = 0;

  constructor(
    @Inject(LONG_TERM_MEMORY_PROVIDER)
    private readonly provider: LongTermMemoryProvider,
    private readonly policyService: MemoryPolicyService,
  ) {}

  async add(input: AddMemoryInput): Promise<MemoryRecord | null> {
    return this.safeRun(() => this.provider.add(input), null, 'add');
  }

  async search(
    input: SearchMemoryInput,
    accessScope?: KnowledgeAccessScope,
  ): Promise<MemoryRecord[]> {
    const memories = await this.safeRun(
      () => this.provider.search(input),
      [],
      'search',
    );
    return this.policyService.filterReadable(memories, accessScope);
  }

  async delete(input: DeleteMemoryInput): Promise<void> {
    await this.safeRun(() => this.provider.delete(input), undefined, 'delete');
  }

  async captureFromConversation(input: {
    ownerId: string;
    department?: string | null;
    conversationId: string;
    userMessage: string;
    assistantMessage: string;
  }): Promise<MemoryRecord | null> {
    const memory = this.policyService.buildMemoryFromConversation(input);
    if (!memory) return null;
    return this.add(memory);
  }

  private async safeRun<T>(
    fn: () => Promise<T>,
    fallback: T,
    operation: string,
  ): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) {
      return fallback;
    }
    try {
      const result = await fn();
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount += 1;
      if (this.failureCount >= 3) {
        this.circuitOpenUntil = Date.now() + 30_000;
      }
      this.logger.warn(
        `长期记忆 ${operation} 失败，已降级：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }
}
