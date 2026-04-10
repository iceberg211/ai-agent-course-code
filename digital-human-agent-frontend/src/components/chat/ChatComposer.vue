<template>
  <div class="composer-wrap">
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
    <button
      v-if="canStop"
      class="action-btn stop-btn"
      type="button"
      @mousedown.stop @mouseup.stop @touchstart.stop.prevent @touchend.stop.prevent
      @click.stop.prevent="$emit('stop')"
      aria-label="停止生成"
    >
      <StopCircleIcon :size="15" aria-hidden="true" />
      <span>停止</span>
    </button>
    <button
      v-else
      class="action-btn send-btn"
      type="button"
      :disabled="sendDisabled"
      @mousedown.stop @mouseup.stop @touchstart.stop.prevent @touchend.stop.prevent
      @click.stop.prevent="submit"
      aria-label="发送文本消息"
    >
      <SendHorizonalIcon :size="15" aria-hidden="true" />
      <span>{{ busy ? '处理中' : '发送' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { SendHorizonalIcon, StopCircleIcon } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  disabled?: boolean
  busy?: boolean
  canStop?: boolean
  placeholder?: string
}>(), {
  disabled: false,
  busy: false,
  canStop: false,
  placeholder: '输入文字后按 Enter 发送，Shift+Enter 换行',
})
const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'stop'): void
}>()

const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const canSend = computed(() => draft.value.trim().length > 0)
const sendDisabled = computed(() => props.disabled || props.busy || !canSend.value)
const resolvedPlaceholder = computed(() => {
  if (props.disabled) return '请先选择角色并连接会话'
  if (props.busy) return '正在处理中，请稍候...'
  return props.placeholder
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
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--border-muted, #edf2f9);
  background: var(--surface, #fff);
}

.composer-input {
  flex: 1;
  min-height: 40px;
  max-height: 140px;
  resize: none;
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 9px 12px;
  outline: none;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text, #0f172a);
  background: var(--surface-soft, #f8fbff);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background 180ms ease;
  font-family: inherit;
  overflow-y: auto;
}
.composer-input::placeholder { color: var(--text-muted, #94a3b8); }
.composer-input:focus {
  border-color: var(--primary, #2563eb);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.composer-input:disabled {
  background: var(--surface-soft, #f8fbff);
  color: var(--text-muted);
  cursor: not-allowed;
}

/* ── 按钮公共 ──────────────────────────────────────────────────── */
.action-btn {
  height: 40px;
  padding: 0 14px;
  border-radius: 10px;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    background 150ms ease,
    box-shadow 150ms ease,
    transform 120ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}
.action-btn:active:not(:disabled) { transform: scale(0.94); }

/* 发送按钮 */
.send-btn {
  background: var(--primary, #2563eb);
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
}
.send-btn:hover:not(:disabled) {
  background: var(--primary-hover, #1d4ed8);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
}
.send-btn:disabled {
  background: var(--border, #e2e8f0);
  color: var(--text-muted, #94a3b8);
  box-shadow: none;
  cursor: not-allowed;
}

/* 停止按钮 */
.stop-btn {
  background: #fff;
  color: var(--error, #dc2626);
  border: 1.5px solid #fca5a5;
  box-shadow: none;
}
.stop-btn:hover {
  background: #fff5f5;
  border-color: var(--error, #dc2626);
}
</style>
