import { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import type { MemoryRecord } from '@/memory/memory.types';

function memory(input: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  const now = new Date();
  return {
    ownerId: 'user-1',
    department: null,
    visibility: 'private',
    category: 'preference',
    content: '默认使用简洁回答',
    sourceConversationId: null,
    confidence: 0.8,
    expiresAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

describe('MemoryPolicyService', () => {
  const service = new MemoryPolicyService();

  it('按 owner、department、visibility 过滤长期记忆', () => {
    const records = [
      memory({ id: 'private-own', ownerId: 'user-1', visibility: 'private' }),
      memory({ id: 'private-other', ownerId: 'user-2', visibility: 'private' }),
      memory({ id: 'dept-own', department: '研发部', visibility: 'department' }),
      memory({ id: 'dept-other', department: '销售部', visibility: 'department' }),
      memory({ id: 'company', visibility: 'company' }),
    ];

    const result = service.filterReadable(records, {
      ownerId: 'user-1',
      department: '研发部',
      role: 'user',
    });

    expect(result.map((item) => item.id)).toEqual([
      'private-own',
      'dept-own',
      'company',
    ]);
  });

  it('能从明确记忆表达中生成长期记忆输入', () => {
    const result = service.buildMemoryFromConversation({
      ownerId: 'user-1',
      department: '研发部',
      conversationId: 'conv-1',
      userMessage: '请记住，以后默认用简短中文回答我。',
      assistantMessage: '好的，我记住了。',
    });

    expect(result).toMatchObject({
      ownerId: 'user-1',
      department: '研发部',
      visibility: 'private',
      category: 'preference',
      sourceConversationId: 'conv-1',
    });
    expect(result?.content).toContain('请记住');
  });
});

