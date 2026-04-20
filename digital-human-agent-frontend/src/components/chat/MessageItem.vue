<template>
  <div class="message" :class="message.role">
    <!-- 头像 -->
    <div class="avatar" aria-hidden="true">
      <BotIcon v-if="message.role === 'assistant'" :size="14" />
      <UserIcon v-else :size="14" />
    </div>

    <!-- 内容 -->
    <div class="body">
      <div class="bubble" :class="{ streaming: message.streaming, interrupted: message.status === 'interrupted' }">
        <TypingIndicator v-if="message.streaming && !message.content" />
        <!-- assistant 消息使用 Markdown 渲染，用户消息保持纯文本 -->
        <div v-else-if="message.role === 'assistant'" class="content md" v-html="renderMarkdown(message.content)" />
        <span v-else class="content">{{ message.content }}</span>
        <!-- 流式光标 -->
        <span v-if="message.streaming && message.content" class="cursor" aria-hidden="true" />
      </div>

      <!-- 状态标签 -->
      <div
        v-if="message.role === 'assistant' && !message.streaming && message.status && message.status !== 'completed'"
        class="status-tag"
        :class="message.status"
      >
        <AlertCircleIcon v-if="message.status === 'failed'" :size="11" />
        <MinusCircleIcon v-else :size="11" />
        {{ statusLabel(message.status) }}
      </div>

      <!-- 引用来源 -->
      <CitationChips :citations="message.citations" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import { BotIcon, UserIcon, AlertCircleIcon, MinusCircleIcon } from 'lucide-vue-next'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'
import CitationChips from '@/components/chat/CitationChips.vue'

// marked 配置：开启 gfm（GitHub Flavored Markdown），关闭 pedantic
marked.setOptions({ gfm: true })

defineProps({
  message: { type: Object, required: true },
})

function statusLabel(status: string) {
  if (status === 'interrupted') return '回复已中断'
  if (status === 'failed') return '回复失败'
  return ''
}

// 将 markdown 文本转为 HTML；内容来自受控后端，不需要额外 sanitize
function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text) as string
}
</script>

<style scoped>
.message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  animation: slideUp 0.2s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.message.user { flex-direction: row-reverse; }

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── 头像 ──────────────────────────────────────────────────────── */
.avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.user      .avatar { background: var(--user-bubble); color: #fff; box-shadow: var(--shadow-btn); }
.assistant .avatar {
  background: var(--surface);
  border: 1.5px solid var(--border);
  color: var(--primary);
  box-shadow: var(--shadow-xs);
}

/* ── 消息体 ────────────────────────────────────────────────────── */
.body { display: flex; flex-direction: column; gap: 5px; max-width: 72%; }
.user      .body { align-items: flex-end; }
.assistant .body { align-items: flex-start; }

/* ── 气泡 ──────────────────────────────────────────────────────── */
.bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  position: relative;
  transition: opacity 200ms ease;
}

/* 用户气泡 */
.user .bubble {
  background: var(--user-bubble);
  color: #fff;
  border-bottom-right-radius: 4px;
  box-shadow: var(--shadow-sm);
}

/* AI 气泡 */
.assistant .bubble {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-xs);
}

/* 流式状态：左边蓝色条动画 */
.assistant .bubble.streaming {
  border-left: 2.5px solid var(--primary);
}

/* 已中断状态：虚线边框 */
.assistant .bubble.interrupted {
  border-style: dashed;
  opacity: 0.8;
}

/* ── 流式光标 ────────────────────────────────────────────────────── */
.cursor {
  display: inline-block;
  width: 2px; height: 1em;
  background: currentColor;
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  animation: blink-caret 0.75s step-end infinite;
}
@keyframes blink-caret {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* ── 状态标签 ─────────────────────────────────────────────────────── */
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-full, 9999px);
}
.status-tag.interrupted { color: var(--warning); background: #fef3c7; }
.status-tag.failed      { color: var(--error);   background: #fee2e2; }

/* ── 内容文字 ─────────────────────────────────────────────────────── */
.content { display: block; }

/* ── Markdown 渲染样式 ───────────────────────────────────────────────── */
.content.md { display: block; }
.content.md :deep(p)  { margin: 0 0 8px; }
.content.md :deep(p:last-child) { margin-bottom: 0; }
.content.md :deep(ul),
.content.md :deep(ol) { margin: 4px 0 8px; padding-left: 20px; }
.content.md :deep(li) { margin: 2px 0; }
.content.md :deep(code) {
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  background: rgba(0,0,0,0.06);
  padding: 1px 5px;
  border-radius: 4px;
}
.content.md :deep(pre) {
  background: #f1f5f9;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 6px 0;
}
.content.md :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 12.5px;
  color: #334155;
}
.content.md :deep(strong) { font-weight: 600; }
.content.md :deep(blockquote) {
  border-left: 3px solid var(--primary-muted);
  margin: 4px 0;
  padding: 2px 10px;
  color: var(--text-secondary);
  font-style: italic;
}
.content.md :deep(h1),
.content.md :deep(h2),
.content.md :deep(h3) {
  font-weight: 600;
  margin: 8px 0 4px;
  line-height: 1.4;
}
.content.md :deep(h1) { font-size: 16px; }
.content.md :deep(h2) { font-size: 14.5px; }
.content.md :deep(h3) { font-size: 13.5px; }
.content.md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 8px 0;
}
.content.md :deep(a) { color: var(--primary); text-decoration: underline; }
</style>
