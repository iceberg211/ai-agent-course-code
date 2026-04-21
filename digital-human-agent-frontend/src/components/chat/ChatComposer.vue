<template>
  <div class="composer-wrap">
    <div class="composer-shell" :class="shellState">
      <div class="composer-meta">
        <div class="composer-status" :class="shellState">
          <span class="status-dot" aria-hidden="true" />
          <span class="status-text">{{ stateLabel }}</span>
        </div>
        <span v-if="shortcutText" class="composer-shortcut" aria-hidden="true">
          {{ shortcutText }}
        </span>
      </div>

      <textarea
        ref="inputEl"
        v-model="draft"
        class="composer-input"
        :placeholder="resolvedPlaceholder"
        :disabled="disabled || busy"
        rows="1"
        @keydown="onKeydown"
        @input="resize"
      />

      <div class="composer-toolbar">
        <p v-if="helperText" class="composer-hint">{{ helperText }}</p>

        <div class="composer-actions">
          <button
            class="voice-btn"
            :class="[voiceButtonClass, { disabled: voiceDisabled }]"
            type="button"
            :disabled="voiceDisabled"
            :aria-label="resolvedVoiceAriaLabel"
            :aria-pressed="voiceState === 'recording'"
            :aria-busy="voicePreparing || voiceState === 'thinking'"
            @click="$emit('mic-toggle')"
          >
            <LoaderCircleIcon
              v-if="voicePreparing || voiceState === 'thinking'"
              :size="18"
              class="spin"
              aria-hidden="true"
            />
            <SendHorizonalIcon
              v-else-if="voiceState === 'recording'"
              :size="18"
              aria-hidden="true"
            />
            <Volume2Icon
              v-else-if="voiceState === 'speaking'"
              :size="18"
              aria-hidden="true"
            />
            <MicIcon v-else :size="18" aria-hidden="true" />
          </button>

          <button
            v-if="canStop"
            class="action-btn stop-btn"
            type="button"
            @mousedown.stop
            @mouseup.stop
            @touchstart.stop.prevent
            @touchend.stop.prevent
            @click.stop.prevent="$emit('stop')"
            aria-label="停止生成"
          >
            <StopCircleIcon :size="16" aria-hidden="true" />
            <span>停止</span>
          </button>
          <button
            v-else
            class="action-btn send-btn"
            type="button"
            :disabled="sendDisabled"
            @mousedown.stop
            @mouseup.stop
            @touchstart.stop.prevent
            @touchend.stop.prevent
            @click.stop.prevent="submit"
            aria-label="发送文本消息"
          >
            <SendHorizonalIcon :size="16" aria-hidden="true" />
            <span>{{ busy ? '处理中' : '发送' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  LoaderCircleIcon,
  MicIcon,
  SendHorizonalIcon,
  StopCircleIcon,
  Volume2Icon,
} from 'lucide-vue-next'
import { CHAT_CONTROL_ARIA_LABELS } from '@/common/constants'
import type { ConversationState } from '@/types'

const props = withDefaults(defineProps<{
  disabled?: boolean
  busy?: boolean
  canStop?: boolean
  placeholder?: string
  voiceState?: ConversationState
  voiceDisabled?: boolean
  voicePreparing?: boolean
}>(), {
  disabled: false,
  busy: false,
  canStop: false,
  placeholder: '输入文字后按 Enter 发送，Shift+Enter 换行',
  voiceState: 'idle',
  voiceDisabled: false,
  voicePreparing: false,
})

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'stop'): void
  (e: 'mic-toggle'): void
}>()

const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => draft.value.trim().length > 0)
const sendDisabled = computed(() => props.disabled || props.busy || !canSend.value)

const shellState = computed(() => {
  if (props.disabled) return 'disabled'
  if (props.canStop) return 'stoppable'
  if (props.busy || props.voiceState === 'recording' || props.voicePreparing) return 'busy'
  return 'ready'
})

const stateLabel = computed(() => {
  if (props.disabled) return '未连接'
  if (props.voicePreparing) return '语音准备中'
  if (props.voiceState === 'recording') return '录音中'
  if (props.voiceState === 'speaking') return '播报中'
  if (props.canStop || props.voiceState === 'thinking') return '处理中'
  if (props.busy) return '处理中'
  return '已就绪'
})

const resolvedPlaceholder = computed(() => {
  if (props.disabled) return '请先选择角色并连接会话'
  if (props.busy && props.voiceState !== 'recording') return '正在处理中，请稍候...'
  return props.placeholder
})

const helperText = computed(() => {
  if (props.disabled) return '选择角色并连接后即可开始输入。'
  if (props.voicePreparing) return '正在建立语音链路。'
  if (props.voiceState === 'recording') return '再次点击麦克风即可结束并发送。'
  if (props.voiceState === 'speaking') return '正在语音播报，可点击麦克风打断。'
  if (props.canStop) return '当前回答仍在生成中，可直接停止。'
  return ''
})

const shortcutText = computed(() => (
  props.disabled || props.busy || props.voicePreparing ? '' : 'Enter 发送 · Shift+Enter 换行'
))

const voiceButtonClass = computed(() => {
  if (props.voicePreparing) return 'preparing'
  return props.voiceState
})

const resolvedVoiceAriaLabel = computed(() => {
  if (props.voicePreparing) return '正在准备语音会话'
  return CHAT_CONTROL_ARIA_LABELS[
    props.voiceState as keyof typeof CHAT_CONTROL_ARIA_LABELS
  ] ?? '点击开始录音'
})

function resize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}

function submit() {
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
  nextTick(resize)
}

function onKeydown(e: KeyboardEvent) {
  if (props.canStop) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

watch(draft, () => nextTick(resize))
onMounted(() => nextTick(resize))
</script>

<style scoped>
.composer-wrap {
  padding: 12px 18px 10px;
  border-top: 1px solid var(--border-muted, #edf2f9);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(248,251,255,0.93) 100%);
}

.composer-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(226, 232, 240, 0.88);
  background: rgba(255,255,255,0.94);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.05);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background 180ms ease;
}

.composer-shell:focus-within {
  border-color: rgba(37, 99, 235, 0.22);
  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.07),
    0 8px 20px rgba(37, 99, 235, 0.06);
}

.composer-shell.busy,
.composer-shell.stoppable {
  background: rgba(248, 251, 255, 0.98);
}

.composer-shell.disabled {
  background: rgba(249, 251, 254, 0.98);
}

.composer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.composer-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #334155);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
  transition: background 180ms ease, box-shadow 180ms ease;
}

.composer-status.ready .status-dot {
  background: var(--primary, #2563eb);
}

.composer-status.busy .status-dot {
  background: var(--warning, #d97706);
}

.composer-status.stoppable .status-dot {
  background: var(--error, #dc2626);
}

.composer-status.disabled .status-dot {
  background: #cbd5e1;
}

.status-text {
  white-space: nowrap;
}

.composer-shortcut {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted, #94a3b8);
  white-space: nowrap;
}

.composer-input {
  width: 100%;
  min-height: 88px;
  max-height: 144px;
  resize: none;
  border: 1px solid rgba(226, 232, 240, 0.84);
  border-radius: 14px;
  padding: 12px 14px;
  outline: none;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text, #0f172a);
  background: rgba(255,255,255,0.96);
  font-family: inherit;
  overflow-y: auto;
  transition:
    border-color 180ms ease,
    background 180ms ease;
}

.composer-input::placeholder {
  color: var(--text-muted, #94a3b8);
}

.composer-input:focus {
  border-color: rgba(37, 99, 235, 0.18);
  background: #fff;
}

.composer-input:disabled {
  background: rgba(248, 250, 252, 0.92);
  color: var(--text-muted);
  cursor: not-allowed;
}

.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.composer-hint {
  min-width: 0;
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #64748b);
  line-height: 1.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.voice-btn,
.action-btn {
  min-height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background 150ms ease,
    color 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 120ms ease;
}

.voice-btn:active:not(:disabled),
.action-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.voice-btn {
  width: 40px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: rgba(248, 251, 255, 0.92);
  color: var(--primary, #2563eb);
}

.voice-btn.idle,
.voice-btn.closed {
  color: var(--primary, #2563eb);
  border-color: rgba(191, 219, 254, 0.92);
  background: rgba(239, 246, 255, 0.92);
}

.voice-btn.preparing,
.voice-btn.thinking {
  color: var(--warning, #d97706);
  border-color: rgba(251, 191, 36, 0.28);
  background: rgba(255, 251, 235, 0.94);
}

.voice-btn.recording {
  color: var(--error, #dc2626);
  border-color: rgba(248, 113, 113, 0.34);
  background: rgba(254, 242, 242, 0.98);
  box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.24);
  animation: voice-record-pulse 1.2s ease-out infinite;
}

.voice-btn.speaking {
  color: var(--success, #059669);
  border-color: rgba(52, 211, 153, 0.28);
  background: rgba(240, 253, 244, 0.94);
}

.voice-btn.disabled {
  color: var(--text-muted, #94a3b8);
  border-color: rgba(226, 232, 240, 0.92);
  background: rgba(248, 250, 252, 0.92);
  box-shadow: none;
  cursor: not-allowed;
  animation: none;
}

.action-btn {
  min-width: 88px;
  padding: 0 14px;
  border: none;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.send-btn {
  background: var(--primary, #2563eb);
  color: #fff;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.15);
}

.send-btn:hover:not(:disabled) {
  background: var(--primary-hover, #1d4ed8);
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.18);
}

.send-btn:disabled {
  background: var(--border, #e2e8f0);
  color: var(--text-muted, #94a3b8);
  box-shadow: none;
  cursor: not-allowed;
}

.stop-btn {
  background: linear-gradient(180deg, #fff 0%, #fff5f5 100%);
  color: var(--error, #dc2626);
  border: 1px solid rgba(248, 113, 113, 0.38);
}

.stop-btn:hover {
  background: linear-gradient(180deg, #fff 0%, #fee2e2 100%);
  border-color: rgba(220, 38, 38, 0.4);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes voice-record-pulse {
  0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.24); }
  70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
  100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
}

@media (max-width: 960px) {
  .composer-wrap {
    padding: 12px 12px 8px;
  }

  .composer-meta,
  .composer-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .composer-shortcut {
    white-space: normal;
  }

  .composer-toolbar {
    gap: 10px;
  }

  .composer-actions {
    width: 100%;
  }

  .action-btn {
    flex: 1;
  }
}
</style>
