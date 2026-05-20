<template>
  <div class="composer-wrap">
    <div class="composer-pill" :class="shellState">
      <!-- 极简三色状态指示呼吸点 -->
      <div 
        class="status-indicator-dot" 
        :class="shellState" 
        :title="stateLabel" 
        aria-hidden="true" 
      />

      <!-- 麦克风录音按钮 -->
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
          :size="15"
          class="spin"
          aria-hidden="true"
        />
        <SendHorizonalIcon
          v-else-if="voiceState === 'recording'"
          :size="15"
          aria-hidden="true"
        />
        <Volume2Icon
          v-else-if="voiceState === 'speaking'"
          :size="15"
          aria-hidden="true"
        />
        <MicIcon v-else :size="15" aria-hidden="true" />
      </button>

      <!-- 单行文本输入框 -->
      <textarea
        ref="inputEl"
        v-model="draft"
        class="composer-input"
        :placeholder="resolvedPlaceholder"
        :disabled="inputDisabled"
        rows="1"
        @keydown="onKeydown"
        @input="resize"
      />

      <!-- 停止生成按钮 -->
      <button
        v-if="canStop"
        class="circle-action-btn stop"
        type="button"
        @mousedown.stop
        @mouseup.stop
        @touchstart.stop.prevent
        @touchend.stop.prevent
        @click.stop.prevent="$emit('stop')"
        aria-label="停止生成"
      >
        <StopCircleIcon :size="15" aria-hidden="true" />
      </button>
      <!-- 发送按钮 -->
      <button
        v-else
        class="circle-action-btn send"
        type="button"
        :disabled="sendDisabled"
        @mousedown.stop
        @mouseup.stop
        @touchstart.stop.prevent
        @touchend.stop.prevent
        @click.stop.prevent="submit"
        aria-label="发送文本消息"
      >
        <SendHorizonalIcon :size="14" aria-hidden="true" />
      </button>
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
  placeholder: '输入问题，补充上下文，或继续下一轮对话',
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
const inputDisabled = computed(
  () => props.disabled || props.voicePreparing || props.voiceState === 'recording',
)

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
  if (props.voicePreparing) return '正在建立语音链路，请稍候...'
  if (props.voiceState === 'recording') return '正在录音，再次点击麦克风即可结束并发送'
  if (props.canStop) return '当前回答仍在生成中，可先写下下一条问题'
  if (props.voiceState === 'speaking') return '正在语音播报，可继续输入下一条问题'
  if (props.busy) return '正在处理中，请稍候...'
  return props.placeholder
})

const helperText = computed(() => {
  if (props.disabled) return '选择角色并连接后即可开始输入。'
  if (props.voicePreparing) return '正在建立语音链路。'
  if (props.voiceState === 'recording') return '再次点击麦克风即可结束并发送。'
  if (props.voiceState === 'speaking') return '正在语音播报，可继续输入下一条问题。'
  if (props.canStop) return '当前回答仍在生成中，可先写草稿，或直接停止。'
  return ''
})

const shortcutText = computed(() => {
  if (inputDisabled.value) return ''
  if (props.canStop) return '可先输入草稿，结束后发送'
  if (props.voiceState === 'speaking') return '可先输入，播报结束后发送'
  return 'Enter 发送 · Shift+Enter 换行'
})

const sendLabel = computed(() => {
  if (props.busy) return '等待中'
  return '发送'
})

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
  if (sendDisabled.value) return
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
  padding: 8px 16px 12px;
  background: transparent;
}

/* 一体式极简控制台胶囊长条 */
.composer-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 14px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(226, 232, 240, 0.85);
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 
    0 4px 18px rgba(15, 23, 42, 0.03),
    0 1px 3px rgba(15, 23, 42, 0.02);
  transition: all 0.25s var(--ease-out);
  max-width: 840px;
  margin: 0 auto;
  width: 100%;
}

.composer-pill:focus-within {
  border-color: rgba(59, 130, 246, 0.45);
  background: #ffffff;
  box-shadow: 
    0 8px 24px rgba(59, 130, 246, 0.08),
    0 1px 2px rgba(59, 130, 246, 0.02);
}

/* 极简内嵌三色状态指示呼吸点 */
.status-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
  transition: all 0.25s ease;
}

.status-indicator-dot.ready {
  background: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  animation: dot-pulse-primary 2s infinite;
}

.status-indicator-dot.busy {
  background: var(--warning);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
  animation: dot-pulse-warning 2s infinite;
}

.status-indicator-dot.stoppable {
  background: var(--error);
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
  animation: dot-pulse-error 2s infinite;
}

.status-indicator-dot.disabled {
  background: #cbd5e1;
  border: 1.5px solid rgba(15, 23, 42, 0.05);
  box-shadow: none;
  animation: none;
}

@keyframes dot-pulse-primary {
  0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.25); }
  70% { box-shadow: 0 0 0 5px rgba(59, 130, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}
@keyframes dot-pulse-warning {
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.25); }
  70% { box-shadow: 0 0 0 5px rgba(245, 158, 11, 0); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}
@keyframes dot-pulse-error {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.25); }
  70% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

/* 极简麦克风录音按钮 */
.voice-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: #fafbfc;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.2s var(--ease-out);
}

.voice-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--primary);
  border-color: var(--primary-muted);
}

.voice-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.voice-btn.idle,
.voice-btn.closed {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.04);
  border-color: rgba(59, 130, 246, 0.12);
}

.voice-btn.preparing,
.voice-btn.thinking {
  color: var(--warning);
  background: rgba(245, 158, 11, 0.04);
  border-color: rgba(245, 158, 11, 0.15);
}

.voice-btn.speaking {
  color: var(--success);
  background: rgba(16, 185, 129, 0.04);
  border-color: rgba(16, 185, 129, 0.15);
}

.voice-btn.disabled {
  color: var(--text-muted);
  background: #f1f5f9;
  border-color: #e2e8f0;
  cursor: not-allowed;
}

.voice-btn.recording {
  color: #fff !important;
  border-color: var(--error) !important;
  background: var(--error) !important;
  position: relative;
  z-index: 1;
}

.voice-btn.recording::before,
.voice-btn.recording::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  border: 1px solid var(--error);
  animation: pulse-ring 1.6s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  opacity: 0;
  z-index: -1;
  pointer-events: none;
}

.voice-btn.recording::after {
  animation-delay: 0.6s;
}

@keyframes pulse-ring {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { opacity: 0.35; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* 单行输入框 */
.composer-input {
  flex: 1;
  min-height: 24px;
  max-height: 90px;
  height: 24px;
  resize: none;
  border: none;
  outline: none;
  padding: 2px 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text);
  background: transparent;
  font-family: inherit;
  overflow-y: auto;
}

.composer-input::placeholder {
  color: var(--text-muted);
  opacity: 0.8;
}

.composer-input:disabled {
  cursor: not-allowed;
  color: var(--text-muted);
}

/* 圆形操作按钮 */
.circle-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.2s var(--ease-out);
}

.circle-action-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.circle-action-btn.send {
  background: var(--primary-gradient);
  color: #fff;
  box-shadow: var(--shadow-btn);
}

.circle-action-btn.send:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: var(--shadow-btn-hover);
  transform: translateY(-0.5px);
}

.circle-action-btn.send:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  box-shadow: none;
  cursor: not-allowed;
}

.circle-action-btn.stop {
  background: #fee2e2;
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
  animation: stop-pulse 2s infinite;
}

.circle-action-btn.stop:hover {
  background: var(--error);
  color: #fff;
}

@keyframes stop-pulse {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.2); }
  70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 600px) {
  .composer-wrap {
    padding: 6px 10px 10px;
  }
  .composer-pill {
    padding: 5px 6px 5px 10px;
    gap: 8px;
  }
}
</style>
