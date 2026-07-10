import type { ConversationMemoryItem } from '@/memory/memory.types';

const MAX_SUMMARY_CHARS = 4000;
const LINE_CONTENT_MAX = 120;

/**
 * 将「旧摘要 + 被挤出窗口的消息」折叠为新摘要（无 LLM，可测）。
 * 策略：保留旧摘要前缀，追加溢出轮次的压缩行，总长截断。
 */
export function foldOverflowIntoSummary(
  previousSummary: string,
  overflowItems: ConversationMemoryItem[],
): string {
  const prev = previousSummary.replace(/\s+/g, ' ').trim();
  if (overflowItems.length === 0) {
    return prev.slice(0, MAX_SUMMARY_CHARS);
  }

  const overflowLines = overflowItems.map(formatMemoryLine).filter(Boolean);
  const overflowBlock = overflowLines.join('；');

  if (!prev) {
    return overflowBlock.slice(0, MAX_SUMMARY_CHARS);
  }

  // 旧摘要可能已很长：优先保留尾部（更近的历史），再拼本次溢出
  const combined = `${prev}；[更早对话] ${overflowBlock}`;
  if (combined.length <= MAX_SUMMARY_CHARS) {
    return combined;
  }

  const keepTail = Math.max(800, Math.floor(MAX_SUMMARY_CHARS * 0.55));
  const headBudget = MAX_SUMMARY_CHARS - keepTail - 20;
  const head = prev.length > headBudget ? `…${prev.slice(-headBudget)}` : prev;
  const tail = overflowBlock.slice(0, keepTail);
  return `${head}；[更早对话] ${tail}`.slice(0, MAX_SUMMARY_CHARS);
}

/**
 * 装配 generate 用的会话上下文：摘要 + 最近 N 条窗口（不重复整窗粘贴）。
 */
export function assembleConversationContextParts(input: {
  summary: string;
  activeContext: string;
  window: ConversationMemoryItem[];
  recentLimit?: number;
}): string[] {
  const recentLimit = Math.max(0, input.recentLimit ?? 4);
  const recent = recentLimit === 0 ? [] : input.window.slice(-recentLimit);
  const recentBlock = recent.map(formatMemoryLine).filter(Boolean).join('\n');

  return [
    input.summary ? `会话摘要：${input.summary}` : '',
    input.activeContext ? `当前任务背景：${input.activeContext}` : '',
    recentBlock ? `最近对话：\n${recentBlock}` : '',
  ].filter(Boolean);
}

export function formatMemoryLine(item: ConversationMemoryItem): string {
  const role =
    item.role === 'assistant' ? '助手' : item.role === 'system' ? '系统' : '用户';
  const content = item.content.replace(/\s+/g, ' ').trim().slice(0, LINE_CONTENT_MAX);
  if (!content) return '';
  return `${role}：${content}`;
}
