<template>
  <div class="message" :class="message.role">
    <!-- 头像容器：User靠右，Agent靠左 -->
    <div class="message-avatar" :class="message.role">
      <template v-if="message.role === 'assistant'">
        {{ personaStore.selectedPersona?.avatarId || personaStore.selectedPersona?.name?.[0] || 'A' }}
      </template>
      <template v-else>
        我
      </template>
    </div>

    <!-- 气泡及内容区 -->
    <div class="message-container">
      <!-- 身份及状态行 -->
      <div class="role-header">
        <span class="role-name">
          {{ message.role === 'assistant' ? (personaStore.selectedPersona?.name || 'Agent') : '你' }}
        </span>
        <div v-if="message.role === 'assistant' && !message.streaming" class="message-actions">
          <button
            v-if="isLast"
            type="button"
            title="重新生成"
            @click="$emit('regenerate')"
          >
            <RefreshCwIcon :size="12" />
          </button>
          <button type="button" title="复制回答" @click="copyMessage">
            <ClipboardIcon :size="12" />
          </button>
          <button
            type="button"
            title="回答有用"
            :class="{ active: message.feedback === 'up' }"
            @click="setFeedback('up')"
          >
            <ThumbsUpIcon :size="12" />
          </button>
          <button
            type="button"
            title="回答无用"
            :class="{ active: message.feedback === 'down' }"
            @click="setFeedback('down')"
          >
            <ThumbsDownIcon :size="12" />
          </button>
        </div>
        <span 
          v-if="message.status && message.status !== 'completed' && !message.streaming" 
          class="status-badge" 
          :class="message.status"
        >
          {{ statusLabel(message.status) }}
        </span>
      </div>

      <!-- 气泡卡片主体 -->
      <div 
        class="message-bubble" 
        :class="[
          message.role,
          { 
            streaming: message.streaming, 
            interrupted: message.status === 'interrupted',
            failed: message.status === 'failed'
          }
        ]"
      >
        <div class="text-flow">
          <TypingIndicator v-if="message.streaming && !message.content" />
          <!-- assistant 消息使用 Markdown 渲染，用户消息保持纯文本 -->
          <div v-else-if="message.role === 'assistant'" class="content md" v-html="renderMarkdown(message.content)" />
          <span v-else class="content">{{ message.content }}</span>
          
          <!-- 流式光标 -->
          <span v-if="message.streaming && message.content" class="cursor" aria-hidden="true" />
        </div>

        <!-- 引用来源 -->
        <CitationChips :citations="message.citations" @show-citation-detail="$emit('show-citation-detail', $event)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import { ClipboardIcon, ThumbsDownIcon, ThumbsUpIcon, RefreshCwIcon } from 'lucide-vue-next'
import { MESSAGE_STATUS_LABELS } from '@/common/constants'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'
import CitationChips from '@/components/chat/CitationChips.vue'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import { usePersonaStore } from '@/stores/persona'
import { useSessionStore } from '@/stores/session'
import type { ChatMessage } from '@/types'

// marked 配置：开启 gfm（GitHub Flavored Markdown）
marked.setOptions({ gfm: true })

const props = withDefaults(
  defineProps<{
    message: ChatMessage
    isLast?: boolean
  }>(),
  {
    isLast: false,
  },
)

defineEmits<{
  (e: 'show-citation-detail', citation: any): void
  (e: 'regenerate'): void
}>()

const personaStore = usePersonaStore()
const sessionStore = useSessionStore()
const productApi = useProductizedKnowledge()

function statusLabel(status: string) {
  return MESSAGE_STATUS_LABELS[status as keyof typeof MESSAGE_STATUS_LABELS] ?? ''
}

// 将 markdown 文本转为 HTML
function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text) as string
}

async function copyMessage() {
  await navigator.clipboard?.writeText(props.message.content)
}

async function setFeedback(next: 'up' | 'down') {
  const conversationId = sessionStore.conversationId
  if (!conversationId || !props.message.id) return
  const feedback = props.message.feedback === next ? null : next
  const ok = await productApi.setMessageFeedback(
    conversationId,
    props.message.id,
    feedback,
  )
  if (ok) props.message.feedback = feedback
}
</script>

<style scoped>
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  align-items: flex-start;
  width: 100%;
  box-sizing: border-box;
  animation: slideUp 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.message.user {
  flex-direction: row-reverse;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.message-container {
  display: flex;
  flex-direction: column;
  max-width: 80%;
}
.message.user .message-container {
  align-items: flex-end;
}
.message.assistant .message-container {
  align-items: flex-start;
}

/* ── 圆润头像 ──────────────────────────────────────────────────────── */
.message-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  user-select: none;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.message-avatar.user {
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  color: #ffffff;
}

.message-avatar.assistant {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #ffffff;
}

/* ── 身份与状态行 ──────────────────────────────────────────────────── */
.role-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 5px;
  user-select: none;
  opacity: 0.65;
  color: var(--text-secondary);
}
.message.user .role-header {
  flex-direction: row-reverse;
}
.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.message-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
}
.message-actions button:hover,
.message-actions button.active {
  border-color: rgba(59, 130, 246, 0.18);
  background: var(--primary-bg);
  color: var(--primary);
}

.status-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
}
.status-badge.interrupted { color: var(--warning); background: rgba(245, 158, 11, 0.1); }
.status-badge.failed      { color: var(--error);   background: rgba(239, 68, 68, 0.1); }

/* ── 气泡卡片主体 ────────────────────────────────────────────────── */
.message-bubble {
  padding: 12px 16px;
  box-sizing: border-box;
  width: 100%;
}

/* 用户气泡：右侧靠拢，温润微蓝背景 */
.message-bubble.user {
  background: #f0f7ff;
  border: 1px solid rgba(59, 130, 246, 0.15);
  color: #1e3a8a;
  border-radius: 16px 4px 16px 16px; /* 右上折角仿对话泡 */
  box-shadow: 
    0 4px 12px rgba(59, 130, 246, 0.02),
    0 1px 2px rgba(59, 130, 246, 0.01);
}

/* 助手气泡：左侧靠拢，清爽白底边框与精致阴影 */
.message-bubble.assistant {
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.9);
  color: var(--text);
  border-radius: 4px 16px 16px 16px; /* 左上折角仿对话泡 */
  box-shadow: 
    0 4px 12px rgba(15, 23, 42, 0.03),
    0 1px 2px rgba(15, 23, 42, 0.01);
  position: relative;
  overflow: hidden;
  padding-left: 18px; /* 留出左侧思考立柱的间距 */
}

/* 渐变思考立柱：嵌入气泡左侧边缘 */
.message-bubble.assistant::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: rgba(59, 130, 246, 0.25);
  transition: background 0.3s ease;
}

.message-bubble.assistant.streaming::before {
  background: linear-gradient(to bottom, #3b82f6, #10b981);
  animation: bar-glow 1.5s ease-in-out infinite alternate;
}

@keyframes bar-glow {
  0% { opacity: 0.6; }
  100% { opacity: 1; }
}

.message-bubble.assistant.interrupted::before {
  background: var(--warning);
}

.message-bubble.assistant.failed::before {
  background: var(--error);
}

.message-bubble.failed {
  border-color: rgba(239, 68, 68, 0.2);
  color: var(--error);
}

.text-flow {
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}

.user .text-flow {
  font-weight: 500;
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
  border: 1px solid rgba(226, 232, 240, 0.1);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 12px 0;
  box-shadow: 
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 4px 12px rgba(0, 0, 0, 0.03);
}
.content.md :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 11.5px;
  color: #e2e8f0;
  font-weight: 400;
  line-height: 1.6;
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
:deep(.citations) {
  margin-top: 10px;
}
</style>
