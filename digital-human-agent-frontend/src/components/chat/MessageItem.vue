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
        <!-- 用 pre-wrap 渲染时保留换行，未来可替换为 markdown 渲染器 -->
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
import { BotIcon, UserIcon, AlertCircleIcon, MinusCircleIcon } from 'lucide-vue-next'
import TypingIndicator from './TypingIndicator.vue'
import CitationChips from './CitationChips.vue'

defineProps({
  message: { type: Object, required: true },
})

function statusLabel(status: string) {
  if (status === 'interrupted') return '回复已中断'
  if (status === 'failed') return '回复失败'
  return ''
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
</style>
