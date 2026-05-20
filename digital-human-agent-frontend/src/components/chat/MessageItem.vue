<template>
  <div class="message" :class="message.role">
    <div class="body">
      <!-- 极简身份与状态标识 -->
      <div class="role-header">
        <span class="role-name">{{ message.role === 'assistant' ? 'Agent' : 'User' }}</span>
        <span 
          v-if="message.status && message.status !== 'completed' && !message.streaming" 
          class="status-badge" 
          :class="message.status"
        >
          {{ statusLabel(message.status) }}
        </span>
      </div>

      <!-- 无气泡极简文本流 -->
      <div 
        class="text-flow" 
        :class="{ 
          streaming: message.streaming, 
          interrupted: message.status === 'interrupted',
          failed: message.status === 'failed'
        }"
      >
        <TypingIndicator v-if="message.streaming && !message.content" />
        <!-- assistant 消息使用 Markdown 渲染，用户消息保持纯文本 -->
        <div v-else-if="message.role === 'assistant'" class="content md" v-html="renderMarkdown(message.content)" />
        <span v-else class="content">{{ message.content }}</span>
        
        <!-- 流式光标 -->
        <span v-if="message.streaming && message.content" class="cursor" aria-hidden="true" />
      </div>

      <!-- 引用来源 -->
      <CitationChips :citations="message.citations" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import { MESSAGE_STATUS_LABELS } from '@/common/constants'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'
import CitationChips from '@/components/chat/CitationChips.vue'

// marked 配置：开启 gfm（GitHub Flavored Markdown）
marked.setOptions({ gfm: true })

defineProps({
  message: { type: Object, required: true },
})

function statusLabel(status: string) {
  return MESSAGE_STATUS_LABELS[status as keyof typeof MESSAGE_STATUS_LABELS] ?? ''
}

// 将 markdown 文本转为 HTML
function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text) as string
}
</script>

<style scoped>
.message {
  display: flex;
  margin-bottom: 24px;
  animation: slideUp 0.2s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.body { 
  display: flex; 
  flex-direction: column; 
  max-width: 88%; 
  width: 100%;
}
.user      .body { align-items: flex-end; }
.assistant .body { align-items: flex-start; }

/* ── 身份与状态行 ──────────────────────────────────────────────────── */
.role-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  user-select: none;
}
.user      .role-header { color: var(--primary); justify-content: flex-end; }
.assistant .role-header { color: var(--text-secondary); }

.status-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
}
.status-badge.interrupted { color: var(--warning); background: rgba(245, 158, 11, 0.1); }
.status-badge.failed      { color: var(--error);   background: rgba(239, 68, 68, 0.1); }

/* ── 无气泡排版主体 ────────────────────────────────────────────────── */
.text-flow {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
  width: 100%;
  box-sizing: border-box;
}

/* 用户纯文本排版 */
.user .text-flow {
  text-align: right;
  color: #1e3a8a; /* 深蓝色高雅文字 */
  font-weight: 500;
  padding-right: 4px;
}

/* AI 科技感左侧渐变垂直线条 */
.assistant .text-flow {
  padding-left: 14px;
  border-left: 2px solid rgba(59, 130, 246, 0.2);
  transition: border-color 0.3s ease;
}

.assistant .text-flow.streaming {
  border-left-color: var(--primary);
  animation: streaming-border-glow 1.5s ease-in-out infinite alternate;
}

@keyframes streaming-border-glow {
  0% { border-left-color: rgba(59, 130, 246, 0.25); }
  100% { border-left-color: var(--primary); }
}

.assistant .text-flow.interrupted {
  border-left-style: dashed;
  border-left-color: var(--warning);
  opacity: 0.8;
}

.assistant .text-flow.failed {
  border-left-color: var(--error);
  color: var(--error);
}

/* ── 流式光标 ────────────────────────────────────────────────────── */
.cursor {
  display: inline-block;
  width: 2px; height: 1.1em;
  background: var(--primary);
  margin-left: 3px;
  vertical-align: text-bottom;
  animation: blink-caret 0.75s step-end infinite;
}
@keyframes blink-caret {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* ── Markdown 渲染样式微调 ───────────────────────────────────────────── */
.content.md { display: block; }
.content.md :deep(p)  { margin: 0 0 10px; }
.content.md :deep(p:last-child) { margin-bottom: 0; }
.content.md :deep(ul),
.content.md :deep(ol) { margin: 6px 0 10px; padding-left: 18px; }
.content.md :deep(li) { margin: 3px 0; }
.content.md :deep(code) {
  font-family: 'Menlo', 'Monaco', 'JetBrains Mono', monospace;
  font-size: 11px;
  background: rgba(59, 130, 246, 0.08);
  color: var(--primary-hover);
  padding: 1.5px 5px;
  border-radius: 4px;
  font-weight: 600;
}
.content.md :deep(pre) {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 10px 14px;
  overflow-x: auto;
  margin: 10px 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}
.content.md :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 11.5px;
  color: #e2e8f0;
  font-weight: 400;
}
.content.md :deep(strong) { font-weight: 600; }
.content.md :deep(blockquote) {
  border-left: 3px solid var(--primary-muted);
  margin: 6px 0;
  padding: 2px 10px;
  color: var(--text-secondary);
  font-style: italic;
}
.content.md :deep(h1),
.content.md :deep(h2),
.content.md :deep(h3) {
  font-weight: 700;
  margin: 12px 0 6px;
  line-height: 1.35;
  color: var(--text);
}
.content.md :deep(h1) { font-size: 15px; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 4px; }
.content.md :deep(h2) { font-size: 13.5px; }
.content.md :deep(h3) { font-size: 12.5px; }
.content.md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 10px 0;
}
.content.md :deep(a) { color: var(--primary); text-decoration: underline; }
.assistant :deep(.citations) {
  margin-left: 14px;
}
</style>
