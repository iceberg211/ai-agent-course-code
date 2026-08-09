import { Injectable } from '@nestjs/common';
import type {
  AddMemoryInput,
  MemoryRecord,
  MemoryVisibility,
} from '@/memory/memory.types';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

@Injectable()
export class MemoryPolicyService {
  filterReadable(
    memories: MemoryRecord[],
    accessScope?: KnowledgeAccessScope,
  ): MemoryRecord[] {
    if (accessScope?.role === 'admin') {
      return memories;
    }
    const ownerId = accessScope?.ownerId ?? '';
    const department = accessScope?.department ?? '';
    return memories.filter((memory) => {
      if (memory.visibility === 'company') return true;
      if (memory.visibility === 'department') {
        return Boolean(department && memory.department === department);
      }
      return Boolean(ownerId && memory.ownerId === ownerId);
    });
  }

  buildMemoryFromConversation(input: {
    ownerId: string;
    department?: string | null;
    conversationId: string;
    userMessage: string;
    assistantMessage: string;
  }): AddMemoryInput | null {
    const content = this.extractUsefulMemory(input.userMessage);
    if (!content) return null;
    return {
      ownerId: input.ownerId,
      department: input.department ?? null,
      visibility: 'private',
      category: this.classify(content),
      content,
      sourceConversationId: input.conversationId,
      confidence: 0.72,
      metadata: {
        source: 'chat_auto_extract',
        assistantPreview: input.assistantMessage.slice(0, 200),
      },
    };
  }

  normalizeVisibility(value: unknown): MemoryVisibility {
    if (value === 'department' || value === 'company') return value;
    return 'private';
  }

  private extractUsefulMemory(text: string): string | null {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < 4 || normalized.length > 500) return null;

    const memoryPatterns = [
      /(?:请记住|记住|以后|下次|我的偏好是|我希望|我喜欢|我不喜欢|默认)(.+)/,
      /(?:我是|我在|我负责|我的岗位是|我的部门是)(.+)/,
    ];
    for (const pattern of memoryPatterns) {
      const match = normalized.match(pattern);
      const value = match?.[0]?.trim();
      if (value && value.length >= 4) {
        return value.slice(0, 500);
      }
    }
    return null;
  }

  private classify(content: string): AddMemoryInput['category'] {
    if (/岗位|部门|负责|我是/.test(content)) return 'profile';
    if (/目标|计划|任务/.test(content)) return 'task_goal';
    if (/项目|业务|客户|流程/.test(content)) return 'business_context';
    return 'preference';
  }
}

