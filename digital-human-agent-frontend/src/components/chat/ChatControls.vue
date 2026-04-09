<template>
  <footer class="controls" role="toolbar" aria-label="对话控制">
    <!-- 左：状态 -->
    <div class="status-info" aria-live="polite">
      <span class="status-dot" :class="state" aria-hidden="true" />
      <span class="status-label">{{ labelMap[state] ?? state }}</span>
    </div>

    <!-- 中：麦克风按钮 -->
    <button
      class="mic-btn"
      :class="state"
      @pointerdown.stop.prevent="onPointerDown"
      @pointerup.stop.prevent="onPointerUp"
      @pointercancel.stop.prevent="onPointerCancel"
      @click.stop.prevent
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-pressed="state === 'recording'"
    >
      <MicIcon      v-if="state === 'idle'"      :size="22" aria-hidden="true" />
      <StopCircleIcon v-else-if="state === 'recording'" :size="22" aria-hidden="true" />
      <PauseIcon    v-else                        :size="22" aria-hidden="true" />
    </button>

    <!-- 右：操作提示 -->
    <div class="mic-hint" aria-hidden="true">{{ hintMap[state] ?? '' }}</div>
  </footer>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MicIcon, StopCircleIcon, PauseIcon } from 'lucide-vue-next'

const props = defineProps({
  state:    { type: String,  default: 'idle' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['mic-down', 'mic-up'])

const labelMap = { idle: '待命', recording: '录音中...', thinking: '思考中', speaking: '播报中', closed: '已结束' }
const hintMap  = { idle: '按住说话', recording: '松开后 1 秒发送', thinking: '点击打断', speaking: '点击打断' }
const ariaMap  = { idle: '按住开始录音', recording: '松开发送语音', thinking: '点击打断 AI', speaking: '点击打断 AI' }
const ariaLabel = computed(() => ariaMap[props.state] ?? '麦克风')
const pointerPressed = ref(false)

function onPointerDown(event) {
  if (props.disabled) return
  pointerPressed.value = true
  try {
    event.currentTarget?.setPointerCapture?.(event.pointerId)
  } catch {
    // 忽略不支持 Pointer Capture 的环境
  }
  emit('mic-down')
}

function onPointerUp(event) {
  if (!pointerPressed.value) return
  pointerPressed.value = false
  try {
    event.currentTarget?.releasePointerCapture?.(event.pointerId)
  } catch {
    // 忽略不支持 Pointer Capture 的环境
  }
  emit('mic-up')
}

function onPointerCancel() {
  pointerPressed.value = false
}
</script>

<style scoped>
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px 18px;
  border-top: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), var(--surface));
  flex-shrink: 0;
}

.status-info { display: flex; align-items: center; gap: 7px; min-width: 100px; }
.status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--text-muted); flex-shrink: 0;
  transition: background 200ms ease;
}
.status-dot.idle      { background: var(--primary-light); }
.status-dot.recording { background: var(--error); animation: pulse-ring 1s infinite; }
.status-dot.thinking  { background: var(--warning); animation: breathe 1.5s infinite; }
.status-dot.speaking  { background: var(--success); animation: glow-green 1.5s infinite; }
.status-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }

.mic-btn {
  width: 56px; height: 56px;
  border-radius: 50%; border: none;
  cursor: pointer; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform 100ms ease-in, background 150ms ease-out, box-shadow 150ms ease-out;
  flex-shrink: 0;
  touch-action: manipulation;
}
.mic-btn:active:not(:disabled) { transform: scale(0.92); }
.mic-btn.idle      { background: var(--primary); box-shadow: 0 6px 20px rgba(31, 111, 235, 0.35); }
.mic-btn.idle:hover { background: var(--primary-hover); box-shadow: 0 8px 24px rgba(31, 111, 235, 0.42); }
.mic-btn.recording { background: var(--error); animation: pulse-ring 1s infinite; }
.mic-btn.thinking  { background: var(--warning); animation: breathe 1.5s infinite; }
.mic-btn.speaking  { background: var(--success); animation: glow-green 1.5s infinite; }
.mic-btn:disabled  { background: #dce4f2; color: #8b99ad; box-shadow: none; cursor: not-allowed; opacity: 0.75; }

.mic-hint { min-width: 100px; text-align: right; font-size: 12px; color: var(--text-muted); }

/* 动画（复用 style.css 中的关键帧）*/
@keyframes pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); }
  70%  { box-shadow: 0 0 0 12px rgba(220,38,38,0); }
  100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
}
@keyframes breathe {
  0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,0.4); }
  50%     { box-shadow: 0 0 0 10px rgba(217,119,6,0); }
}
@keyframes glow-green {
  0%,100% { box-shadow: 0 0 0 0 rgba(5,150,105,0.4); }
  50%     { box-shadow: 0 0 0 10px rgba(5,150,105,0); }
}

@media (max-width: 960px) {
  .controls {
    padding: 12px;
  }
  .status-info,
  .mic-hint {
    min-width: auto;
  }
  .mic-hint {
    display: none;
  }
}
</style>
