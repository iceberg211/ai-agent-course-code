import {
  assembleConversationContextParts,
  foldOverflowIntoSummary,
} from '@/memory/utils/rolling-summary.utils';

describe('rolling-summary.utils', () => {
  it('溢出消息会并入摘要且不丢旧摘要', () => {
    const next = foldOverflowIntoSummary('用户问过合同期限', [
      { role: 'user', content: '付款条件是什么？' },
      { role: 'assistant', content: '验收后七日内付款。' },
    ]);
    expect(next).toContain('合同期限');
    expect(next).toContain('付款条件');
    expect(next).toContain('七日内');
  });

  it('摘要过长时会截断', () => {
    const longPrev = '甲'.repeat(5000);
    const next = foldOverflowIntoSummary(longPrev, [
      { role: 'user', content: '新问题' },
    ]);
    expect(next.length).toBeLessThanOrEqual(4000);
    expect(next).toContain('新问题');
  });

  it('装配上下文包含摘要与最近对话', () => {
    const parts = assembleConversationContextParts({
      summary: '讨论过验收',
      activeContext: '法务审阅',
      window: [
        { role: 'user', content: '旧' },
        { role: 'user', content: '新问题' },
        { role: 'assistant', content: '新回答' },
      ],
      recentLimit: 2,
    });
    const text = parts.join('\n');
    expect(text).toContain('讨论过验收');
    expect(text).toContain('法务审阅');
    expect(text).toContain('新问题');
    expect(text).not.toContain('用户：旧');
  });

  it('recentLimit=0 时不拼接窗口消息', () => {
    const parts = assembleConversationContextParts({
      summary: '已有摘要',
      activeContext: '',
      window: [{ role: 'user', content: '不应重复注入' }],
      recentLimit: 0,
    });
    expect(parts.join('\n')).not.toContain('不应重复注入');
  });
});
