<template>
  <section class="digital-workspace" aria-label="数字人播报工作区">
    <div class="stage-panel">
      <div class="stage-head">
        <div class="stage-copy">
          <p class="eyebrow">数字人模式</p>
          <div class="stage-title-row">
            <h3>数字人播报</h3>
            <span class="stage-badge" :class="`stage-badge--${status}`">
              <span class="stage-badge__dot" />
              {{ statusLabel }}
            </span>
          </div>
          <p class="stage-desc">{{ compactDescription }}</p>
        </div>

        <button
          class="stage-action-btn"
          type="button"
          :aria-expanded="settingsOpen"
          @click="settingsOpen = true"
        >
          <SlidersHorizontalIcon :size="15" aria-hidden="true" />
          <span>音色与设置</span>
        </button>
      </div>

      <div class="stage-meta">
        <span class="meta-pill" :class="cloneStatusClass">音色：{{ cloneStatusLabel }}</span>
        <span class="meta-pill" :class="`meta-pill--${status}`">连接：{{ statusLabel }}</span>
        <span class="meta-pill meta-pill--muted">音色 ID：{{ voiceIdShort }}</span>
      </div>

      <div class="digital-stage__frame">
        <div class="digital-stage__glow" aria-hidden="true" />

        <div class="digital-stage__viewport">
          <video
            ref="videoEl"
            class="digital-video"
            autoplay
            playsinline
          />

          <div v-if="showPlaceholder" class="stage-placeholder">
            <SparklesIcon :size="26" aria-hidden="true" />
            <p class="stage-placeholder__title">{{ placeholderTitle }}</p>
            <p class="stage-placeholder__desc">{{ placeholderDesc }}</p>
            <div class="stage-placeholder__actions">
              <button
                v-if="placeholderAction"
                class="stage-placeholder__btn"
                type="button"
                :disabled="placeholderAction.disabled"
                @click="runPlaceholderAction"
              >
                {{ placeholderAction.label }}
              </button>
              <button
                class="stage-placeholder__ghost"
                type="button"
                @click="settingsOpen = true"
              >
                打开设置
              </button>
            </div>
          </div>
        </div>

        <div class="stage-overlay">
          <span class="overlay-pill">知识范围保持不变</span>
        </div>
      </div>

      <div class="stage-footer">
        <p class="stage-note">{{ stageNote }}</p>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="config-drawer">
        <div
          v-if="settingsOpen"
          class="config-backdrop"
          @click.self="settingsOpen = false"
        >
          <aside class="config-drawer" aria-label="数字人音色与设置抽屉">
            <div class="config-drawer__head">
              <div>
                <p class="eyebrow">音色与设置</p>
                <h4>数字人准备</h4>
              </div>
              <button
                class="drawer-close"
                type="button"
                aria-label="关闭设置抽屉"
                @click="settingsOpen = false"
              >
                <XIcon :size="16" aria-hidden="true" />
              </button>
            </div>

            <div class="config-drawer__body">
              <div class="config-section">
                <div class="section-header">
                  <h5>准备进度</h5>
                  <p>三步完成后，就可以直接拿真实问题验证数字人播报效果。</p>
                </div>

                <ol class="setup-list" role="list">
                  <li
                    v-for="(step, index) in setupSteps"
                    :key="`${index}-${step.title}`"
                    class="setup-item"
                    :class="{ 'setup-item--done': step.done }"
                  >
                    <span class="setup-item__index">{{ index + 1 }}</span>
                    <div class="setup-item__copy">
                      <strong>{{ step.title }}</strong>
                      <p>{{ step.description }}</p>
                    </div>
                  </li>
                </ol>
              </div>

              <div class="config-section">
                <div class="section-header">
                  <h5>当前状态</h5>
                  <p>这里可以快速确认数字人链路和音色准备情况。</p>
                </div>

                <div class="metric-list">
                  <div class="metric-row">
                    <span class="metric-label">播报状态</span>
                    <span class="status-pill" :class="`status-pill--${status}`">
                      {{ statusLabel }}
                    </span>
                  </div>
                  <div class="metric-row">
                    <span class="metric-label">音色状态</span>
                    <span class="clone-pill" :class="cloneStatusClass">
                      {{ cloneStatusLabel }}
                    </span>
                  </div>
                  <div class="metric-stack">
                    <span class="metric-label">当前音色</span>
                    <span class="metric-value" :title="voiceIdDisplay">{{ voiceIdDisplay }}</span>
                  </div>
                </div>
              </div>

              <div class="config-section">
                <div class="section-header">
                  <h5>音色样本</h5>
                  <p>上传一段清晰语音，让数字人播报更贴近真实表达。</p>
                </div>

                <div class="action-group">
                  <button
                    class="config-btn config-btn--primary"
                    type="button"
                    :disabled="voiceCloneUploading"
                    @click="openFilePicker"
                  >
                    <UploadCloudIcon :size="15" aria-hidden="true" />
                    <span>{{ voiceCloneUploading ? '上传中' : '上传音色样本' }}</span>
                  </button>
                  <button
                    class="config-btn"
                    type="button"
                    :disabled="voiceCloneLoading"
                    @click="emit('refresh-voice-clone')"
                  >
                    <RefreshCcwIcon :size="15" aria-hidden="true" />
                    <span>{{ voiceCloneLoading ? '刷新中' : '刷新状态' }}</span>
                  </button>
                </div>

                <p class="config-tip">
                  建议上传 3-10 分钟样本，支持 wav/mp3/m4a/aac。
                </p>
                <p v-if="error" class="config-error" role="alert">{{ error }}</p>
              </div>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <input
      ref="voiceInputEl"
      type="file"
      :accept="VOICE_CLONE_FILE_ACCEPT"
      class="sr-only"
      @change="onVoiceFileChange"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  RefreshCcwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-vue-next'
import {
  DIGITAL_HUMAN_STATUS_LABELS,
  VOICE_CLONE_FILE_ACCEPT,
  VOICE_CLONE_STATUS_LABELS,
} from '@/common/constants'
import type { VoiceCloneState } from '@/types'

const props = defineProps<{
  bindVideo: (el: HTMLVideoElement | null) => void
  status: 'idle' | 'connecting' | 'connected' | 'mock' | 'error'
  error?: string
  voiceCloneState: VoiceCloneState | null
  voiceCloneLoading: boolean
  voiceCloneUploading: boolean
}>()

const emit = defineEmits<{
  (e: 'upload-voice-sample', file: File): void
  (e: 'refresh-voice-clone'): void
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const voiceInputEl = ref<HTMLInputElement | null>(null)
const settingsOpen = ref(false)

const statusLabel = computed(
  () => DIGITAL_HUMAN_STATUS_LABELS[props.status] ?? props.status,
)

const cloneStatus = computed(
  () => props.voiceCloneState?.status ?? 'not_started',
)

const cloneStatusLabel = computed(
  () => VOICE_CLONE_STATUS_LABELS[cloneStatus.value] ?? cloneStatus.value,
)

const cloneStatusClass = computed(
  () => `clone-pill--${cloneStatus.value}`,
)

const voiceReady = computed(() => cloneStatus.value === 'ready')

const voiceIdDisplay = computed(
  () => props.voiceCloneState?.voiceId || '未配置专属音色',
)

const voiceIdShort = computed(() => {
  if (!props.voiceCloneState?.voiceId) return '未配置'
  return props.voiceCloneState.voiceId.length > 18
    ? `${props.voiceCloneState.voiceId.slice(0, 8)}...`
    : props.voiceCloneState.voiceId
})

const showPlaceholder = computed(
  () => props.status === 'idle' || props.status === 'connecting' || props.status === 'error',
)

const compactDescription = computed(() => {
  if (props.status === 'connected' || props.status === 'mock') {
    return voiceReady.value
      ? '已接入当前会话，回答会按现有知识范围直接播报。'
      : '通道已接入，补充音色样本后会得到更自然的播报效果。'
  }

  if (props.status === 'connecting') {
    return '正在建立数字人链路，连接成功后会自动接管回答播报。'
  }

  if (props.status === 'error') {
    return '当前连接异常，可以先刷新状态，必要时重新上传音色样本。'
  }

  return voiceReady.value
    ? '数字人已待命，发送问题后就会按当前知识范围播报。'
    : '先准备音色样本，再开始验证数字人播报效果。'
})

const placeholderTitle = computed(() => {
  if (props.status === 'connecting') return '数字人正在连接'
  if (props.status === 'error') return '数字人暂时不可用'
  return '准备开始数字人播报'
})

const placeholderDesc = computed(() => {
  if (props.status === 'error') {
    return props.error || '可以先刷新状态，或重新上传音色样本后再试。'
  }
  if (props.status === 'connecting') {
    return '连接完成后，回答会以数字人方式实时播报。'
  }
  return voiceReady.value
    ? '回答会按当前知识范围切换为数字人视频和语音播报。'
    : '先上传音色样本，会得到更自然的数字人播报效果。'
})

const placeholderAction = computed(() => {
  if (!voiceReady.value) {
    return {
      label: props.voiceCloneUploading ? '上传中…' : '上传音色样本',
      disabled: props.voiceCloneUploading,
      type: 'upload' as const,
    }
  }

  if (props.status === 'idle' || props.status === 'error') {
    return {
      label: props.voiceCloneLoading ? '刷新中…' : '刷新状态',
      disabled: props.voiceCloneLoading,
      type: 'refresh' as const,
    }
  }

  return null
})

const setupSteps = computed(() => [
  {
    title: voiceReady.value ? '音色样本已准备' : '上传音色样本',
    description: voiceReady.value
      ? '当前专属音色已经可用，可以继续验证播报效果。'
      : '建议准备 3-10 分钟的清晰语音样本，先完成这一步。',
    done: voiceReady.value,
  },
  {
    title: props.status === 'connected' || props.status === 'mock' ? '数字人通道已连接' : '等待数字人连接',
    description: props.status === 'error'
      ? (props.error || '可以先刷新状态，再重新尝试连接数字人。')
      : '连接完成后，回答会切换为数字人视频与语音展示。',
    done: props.status === 'connected' || props.status === 'mock',
  },
  {
    title: '发送问题开始验证',
    description: voiceReady.value
      ? '保持现有问答流程不变，直接发一个真实问题观察播报效果。'
      : '等音色准备完成后，就可以直接发问题开始验证。',
    done: voiceReady.value && (props.status === 'connected' || props.status === 'mock'),
  },
])

const stageNote = computed(() => {
  const nextStep = setupSteps.value.find((step) => !step.done)
  if (nextStep) return `下一步：${nextStep.description}`
  return '可以直接发送一个真实问题，观察数字人播报和回答节奏。'
})

function openFilePicker() {
  voiceInputEl.value?.click()
}

function runPlaceholderAction() {
  if (!placeholderAction.value) return
  if (placeholderAction.value.type === 'upload') {
    openFilePicker()
    return
  }
  emit('refresh-voice-clone')
}

function onVoiceFileChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file) return
  emit('upload-voice-sample', file)
  target.value = ''
}

watch(
  videoEl,
  (el) => {
    props.bindVideo(el)
  },
  { immediate: true },
)
</script>

<style scoped>
.digital-workspace {
  width: min(320px, 100%);
  max-width: 100%;
  flex-shrink: 0;
}

.stage-panel {
  position: relative;
  padding: 16px 16px 14px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 24px;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.92), transparent 38%),
    linear-gradient(180deg, #ffffff, #f7faff 72%, #f3f8ff);
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.94);
}

.stage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.stage-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.stage-title-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.stage-copy h3 {
  margin: 0;
  font-size: 21px;
  line-height: 1.04;
  letter-spacing: -0.02em;
  color: var(--text);
}

.stage-desc {
  margin: 0;
  max-width: none;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-secondary);
}

.stage-action-btn {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.94);
  background: rgba(255, 255, 255, 0.92);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
  white-space: nowrap;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  transition:
    background-color 150ms ease,
    color 150ms ease,
    border-color 150ms ease,
    transform 120ms ease,
    box-shadow 150ms ease;
}

.stage-action-btn:hover {
  background: var(--primary-bg);
  border-color: var(--primary-muted);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(37, 99, 235, 0.12);
}

.stage-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.meta-pill,
.overlay-pill,
.stage-badge,
.status-pill,
.clone-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.meta-pill {
  max-width: 100%;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: rgba(255, 255, 255, 0.88);
  color: var(--text-secondary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.meta-pill--muted {
  max-width: 168px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.digital-stage__frame {
  position: relative;
  margin-top: 12px;
  height: 340px;
  border-radius: 22px;
  overflow: hidden;
  border: 1px solid rgba(191, 219, 254, 0.86);
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.54), transparent 30%),
    linear-gradient(180deg, #eaf3ff, #dce8fb 72%, #e6eefc);
}

.digital-stage__glow {
  position: absolute;
  inset: auto -12% -18%;
  height: 48%;
  border-radius: 50%;
  background: rgba(96, 165, 250, 0.22);
  filter: blur(34px);
  pointer-events: none;
}

.digital-stage__viewport {
  position: absolute;
  inset: 16px 16px 20px;
  border-radius: 20px;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(248, 251, 255, 0.96), rgba(229, 237, 249, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.94);
  box-shadow:
    0 18px 36px rgba(15, 23, 42, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.94);
}

.digital-video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  object-position: center center;
  background: transparent;
}

.stage-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 26px;
  text-align: center;
  color: var(--text-secondary);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.46), rgba(239, 245, 255, 0.42));
  backdrop-filter: blur(4px);
}

.stage-placeholder__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

.stage-placeholder__desc {
  margin: 0;
  max-width: 220px;
  font-size: 12px;
  line-height: 1.7;
}

.stage-placeholder__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 168px;
}

.stage-placeholder__btn,
.stage-placeholder__ghost {
  min-height: 38px;
  width: 100%;
  padding: 0 14px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  appearance: none;
  -webkit-appearance: none;
  transition:
    transform 120ms ease,
    box-shadow 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    border-color 150ms ease;
}

.stage-placeholder__btn {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  box-shadow: var(--shadow-btn);
}

.stage-placeholder__btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-btn-hover);
}

.stage-placeholder__ghost {
  border: 1px solid rgba(226, 232, 240, 0.94);
  background: rgba(255, 255, 255, 0.92);
  color: var(--text-secondary);
}

.stage-placeholder__ghost:hover {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}

.stage-overlay {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 1;
}

.overlay-pill,
.stage-badge {
  gap: 6px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: var(--text-secondary);
  backdrop-filter: blur(8px);
}

.stage-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-pill--idle,
.clone-pill--not_started,
.meta-pill--idle {
  background: #f1f5f9;
  color: #64748b;
}

.status-pill--connecting,
.clone-pill--pending,
.clone-pill--training,
.stage-badge--connecting,
.meta-pill--connecting {
  background: #fff7ed;
  color: #c2410c;
}

.status-pill--connected,
.clone-pill--ready,
.stage-badge--connected,
.meta-pill--connected {
  background: #ecfdf5;
  color: #15803d;
}

.status-pill--mock,
.stage-badge--mock,
.meta-pill--mock {
  background: var(--primary-bg);
  color: var(--primary);
}

.status-pill--error,
.clone-pill--failed,
.stage-badge--error,
.meta-pill--error {
  background: #fef2f2;
  color: #b91c1c;
}

.stage-footer {
  margin-top: 12px;
}

.stage-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.65;
  color: var(--text-muted);
}

.config-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.26);
  backdrop-filter: blur(10px);
}

.config-drawer {
  width: 100vw;
  height: 100vh;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.9), transparent 30%),
    linear-gradient(180deg, rgba(249, 251, 255, 0.99), rgba(244, 248, 255, 0.99));
  border: none;
  border-radius: 0;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.config-drawer__head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 22px 28px 18px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.86);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  background: rgba(249, 251, 255, 0.9);
  backdrop-filter: blur(14px);
}

.config-drawer__head h4 {
  margin: 0;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.03em;
  color: var(--text);
}

.drawer-close {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: #f8fafc;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  line-height: 1;
  appearance: none;
  -webkit-appearance: none;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.drawer-close:hover {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}

.config-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 36px;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 18px;
  align-content: start;
}

.config-section {
  padding: 18px 20px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 251, 255, 0.98));
  border: 1px solid rgba(226, 232, 240, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.config-section:first-child {
  grid-column: 1 / -1;
}

.section-header h5 {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}

.section-header p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

.setup-list {
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setup-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(226, 232, 240, 0.88);
  background: #fbfdff;
}

.setup-item--done {
  border-color: rgba(134, 239, 172, 0.68);
  background: #f0fdf4;
}

.setup-item__index {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.setup-item--done .setup-item__index {
  background: #dcfce7;
  color: #15803d;
}

.setup-item__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setup-item__copy strong {
  font-size: 13px;
  color: var(--text);
}

.setup-item__copy p {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

.metric-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.metric-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.metric-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 2px;
}

.metric-label {
  font-size: 12px;
  color: var(--text-muted);
}

.metric-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-group {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 42px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: var(--surface);
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  appearance: none;
  -webkit-appearance: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.config-btn:hover:not(:disabled) {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}

.config-btn--primary {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}

.config-btn--primary:hover:not(:disabled) {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.config-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.config-tip {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
}

.config-error {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--error);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.config-drawer-enter-active,
.config-drawer-leave-active {
  transition: opacity 180ms ease, transform 220ms ease;
}

.config-drawer-enter-from,
.config-drawer-leave-to {
  opacity: 0;
}

.config-drawer-enter-from .config-drawer,
.config-drawer-leave-to .config-drawer {
  transform: translateY(16px);
}

@media (max-width: 960px) {
  .digital-workspace {
    width: 100%;
  }

  .stage-panel {
    padding: 12px;
  }

  .stage-desc {
    max-width: none;
  }

  .digital-stage__frame {
    height: 312px;
  }

  .config-drawer__head {
    padding: 18px 18px 16px;
  }

  .config-drawer__head h4 {
    font-size: 24px;
  }

  .config-drawer__body {
    padding: 18px 18px 28px;
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .stage-action-btn {
    min-width: 42px;
    padding: 0 12px;
  }

  .digital-stage__frame {
    height: 300px;
  }

  .digital-stage__viewport {
    inset: 12px 12px 18px;
  }

  .config-drawer__head {
    padding: 16px 16px 14px;
  }

  .config-drawer__head h4 {
    font-size: 22px;
  }

  .config-drawer__body {
    padding: 16px 16px 24px;
    gap: 14px;
  }

  .config-section {
    padding: 16px;
  }
}
</style>
