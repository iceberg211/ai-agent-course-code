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
      class="send-btn"
      type="button"
      :disabled="sendDisabled"
      @click="submit"
      aria-label="发送文本消息"
    >
      <SendHorizonalIcon :size="16" aria-hidden="true" />
      <span>{{ busy ? '发送中' : '发送' }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { SendHorizonalIcon } from 'lucide-vue-next'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  placeholder: { type: String, default: '输入文字后按 Enter 发送，Shift+Enter 换行' },
})
const emit = defineEmits(['send'])

const draft = ref('')
const inputEl = ref(null)
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

function onKeydown(e) {
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
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.composer-input {
  flex: 1;
  min-height: 42px;
  max-height: 120px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
  font-size: 14px;
  color: var(--text);
  background: #fff;
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  font-family: inherit;
}
.composer-input::placeholder {
  color: var(--text-muted);
}
.composer-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.16);
}
.composer-input:disabled {
  background: #f3f6fc;
  color: var(--text-muted);
}
.send-btn {
  height: 42px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms ease-out, opacity 150ms ease-out;
}
.send-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
