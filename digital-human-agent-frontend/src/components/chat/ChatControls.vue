<template>
  <footer class="controls" role="toolbar" aria-label="对话控制">
    <!-- 左：状态指示 -->
    <div class="status-info" aria-live="polite">
      <div class="status-pill" :class="state">
        <span class="pulse-ring" v-if="state === 'recording'" aria-hidden="true" />
        <span class="status-dot" aria-hidden="true" />
        <span class="status-label">{{ labelMap[state] ?? state }}</span>
      </div>
    </div>

    <!-- 中：麦克风按钮 -->
    <div class="mic-wrap">
      <button
        class="mic-btn"
        :class="[state, { disabled }]"
        @pointerdown.stop.prevent="onPointerDown"
        @pointerup.stop.prevent="onPointerUp"
        @pointercancel.stop.prevent="onPointerCancel"
        @click.stop.prevent
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-pressed="state === 'recording'"
      >
        <MicIcon        v-if="state === 'idle'"      :size="20" aria-hidden="true" />
        <StopCircleIcon v-else-if="state === 'recording'" :size="20" aria-hidden="true" />
        <PauseIcon      v-else                        :size="20" aria-hidden="true" />
      </button>
      <div class="mic-hint-bubble" aria-hidden="true">{{ hintMap[state] ?? '' }}</div>
    </div>

    <!-- 右：快捷键提示 -->
    <div class="shortcut-tip" aria-hidden="true">
      <kbd>Enter</kbd> 发送 &nbsp;·&nbsp; <kbd>Shift+Enter</kbd> 换行
    </div>
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

const labelMap: Record<string, string> = {
  idle: '待命', recording: '录音中', thinking: '思考中', speaking: '播报中', closed: '已结束',
}
const hintMap: Record<string, string> = {
  idle: '按住说话', recording: '松开 · 1 秒后发送', thinking: '点击打断', speaking: '点击打断',
}
const ariaMap: Record<string, string> = {
  idle: '按住开始录音', recording: '松开发送语音', thinking: '点击打断 AI', speaking: '点击打断 AI',
}
const ariaLabel = computed(() => ariaMap[props.state] ?? '麦克风')
const pointerPressed = ref(false)

function onPointerDown(event: PointerEvent) {
  if (props.disabled) return
  pointerPressed.value = true
  try { (event.currentTarget as Element)?.setPointerCapture?.(event.pointerId) } catch { /* noop */ }
  emit('mic-down')
}

function onPointerUp(event: PointerEvent) {
  if (!pointerPressed.value) return
  pointerPressed.value = false
  try { (event.currentTarget as Element)?.releasePointerCapture?.(event.pointerId) } catch { /* noop */ }
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
  padding: 12px 24px 16px;
  border-top: 1px solid var(--border-muted, #edf2f9);
  background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(248,251,255,0.95) 100%);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}

/* ── 状态指示 ──────────────────────────────────────────────────── */
.status-info { min-width: 108px; }

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px 4px 8px;
  border-radius: var(--radius-full, 9999px);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted, #64748b);
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
  transition: all 200ms ease;
  position: relative;
}

.status-pill.recording { color: #dc2626; border-color: #fca5a5; background: #fff5f5; }
.status-pill.thinking  { color: #d97706; border-color: #fcd34d; background: #fffbeb; }
.status-pill.speaking  { color: #059669; border-color: #6ee7b7; background: #f0fdf4; }

.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-muted, #94a3b8);
  flex-shrink: 0;
  transition: background 200ms ease;
}
.status-pill.idle      .status-dot { background: var(--primary-light, #3b82f6); }
.status-pill.recording .status-dot { background: #dc2626; }
.status-pill.thinking  .status-dot { background: #d97706; }
.status-pill.speaking  .status-dot { background: #059669; }

/* 录音时外圈动画 */
.pulse-ring {
  position: absolute;
  left: 6px;
  width: 8px; height: 8px;
  border-radius: 50%;
  border: 2px solid #dc2626;
  animation: pulse 1.2s ease-out infinite;
}
@keyframes pulse {
  0%   { transform: scale(0.8); opacity: 0.9; }
  80%  { transform: scale(1.8); opacity: 0; }
  100% { opacity: 0; }
}

/* ── 麦克风按钮 ───────────────────────────────────────────────────── */
.mic-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.mic-btn {
  width: 52px; height: 52px;
  border-radius: 50%;
  border: none;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition:
    transform 120ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
    background 150ms ease,
    box-shadow 150ms ease;
  flex-shrink: 0;
  touch-action: manipulation;
  user-select: none;
}
.mic-btn:active:not(.disabled) { transform: scale(0.88); }

.mic-btn.idle {
  background: var(--primary, #2563eb);
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4);
}
.mic-btn.idle:hover:not(.disabled) {
  background: var(--primary-hover, #1d4ed8);
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
  transform: translateY(-1px);
}
.mic-btn.recording {
  background: #dc2626;
  box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5);
  animation: mic-record-pulse 1.2s ease-out infinite;
}
.mic-btn.thinking  { background: #d97706; animation: mic-breathe 1.5s ease-in-out infinite; }
.mic-btn.speaking  { background: #059669; animation: mic-glow-green 1.5s ease-in-out infinite; }
.mic-btn.disabled  { background: #cbd5e1; box-shadow: none; cursor: not-allowed; }

@keyframes mic-record-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5); }
  70%  { box-shadow: 0 0 0 14px rgba(220, 38, 38, 0); }
  100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
}
@keyframes mic-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.4); }
  50%       { box-shadow: 0 0 0 10px rgba(217, 119, 6, 0); }
}
@keyframes mic-glow-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(5, 150, 105, 0.4); }
  50%       { box-shadow: 0 0 0 10px rgba(5, 150, 105, 0); }
}

/* ── 悬浮提示 ────────────────────────────────────────────────────── */
.mic-hint-bubble {
  font-size: 10px;
  color: var(--text-muted, #64748b);
  white-space: nowrap;
  min-height: 14px;
  transition: opacity 150ms ease;
}

/* ── 快捷键提示 ───────────────────────────────────────────────────── */
.shortcut-tip {
  min-width: 108px;
  text-align: right;
  font-size: 11px;
  color: var(--text-muted, #64748b);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
}
kbd {
  display: inline-flex;
  padding: 1px 5px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 4px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  background: var(--surface, #fff);
  color: var(--text-secondary, #334155);
  box-shadow: 0 1px 0 var(--border, #e2e8f0);
  white-space: nowrap;
}

@media (max-width: 960px) {
  .controls { padding: 10px 14px 14px; }
  .shortcut-tip { display: none; }
  .status-info { min-width: auto; }
}
</style>
