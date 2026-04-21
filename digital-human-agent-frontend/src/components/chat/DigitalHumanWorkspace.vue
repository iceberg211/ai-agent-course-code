<template>
  <section class="digital-workspace" aria-label="数字人播报工作区">
    <div class="workspace-shell">
      <div class="stage-panel">
        <div class="stage-copy">
          <p class="eyebrow">特色功能</p>
          <div class="stage-title-row">
            <h3>数字人播报</h3>
            <span class="stage-badge" :class="`stage-badge--${status}`">
              <span class="stage-badge__dot" />
              {{ statusLabel }}
            </span>
          </div>
          <p class="stage-desc">
            当前问答仍然基于已挂载知识库，数字人负责把回答以视频和语音方式展示。
            {{ voiceReady ? '音色已经准备完成，可以直接验证播报效果。' : '建议先上传音色样本，再开始验证数字人播报。' }}
          </p>
        </div>

        <div class="digital-stage__frame">
          <video
            ref="videoEl"
            class="digital-video"
            autoplay
            playsinline
          />

          <div v-if="showPlaceholder" class="stage-placeholder">
            <SparklesIcon :size="28" aria-hidden="true" />
            <p class="stage-placeholder__title">{{ placeholderTitle }}</p>
            <p class="stage-placeholder__desc">{{ placeholderDesc }}</p>
          </div>

          <div class="stage-overlay">
            <span class="overlay-pill">知识范围保持不变</span>
          </div>
        </div>
      </div>

      <aside class="config-panel" aria-label="数字人播报设置">
        <div class="config-section">
          <div class="section-header">
            <h4>播报设置</h4>
            <p>让数字人以更自然的方式展示回答。</p>
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
            <h4>音色样本</h4>
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
      </aside>
    </div>

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
  SparklesIcon,
  UploadCloudIcon,
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

const showPlaceholder = computed(
  () => props.status === 'idle' || props.status === 'connecting' || props.status === 'error',
)

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
    ? '保持当前问答流程不变，回答会以数字人方式播报。'
    : '先上传音色样本，会得到更自然的数字人播报效果。'
})

function openFilePicker() {
  voiceInputEl.value?.click()
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
  margin: 12px 16px 0;
  flex-shrink: 0;
}

.workspace-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(280px, 340px);
  gap: 14px;
  align-items: stretch;
}

.stage-panel,
.config-panel {
  border: 1px solid var(--border);
  border-radius: 20px;
  background: linear-gradient(180deg, #ffffff, #f8fbff);
}

.stage-panel {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.stage-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.stage-copy h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
  color: var(--text);
}

.stage-desc {
  margin: 8px 0 0;
  max-width: 640px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.digital-stage__frame {
  position: relative;
  width: 100%;
  height: clamp(280px, 42vh, 420px);
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(143, 171, 214, 0.45);
  background:
    radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.55), transparent 42%),
    linear-gradient(180deg, #eaf2ff, #dbe8fb);
  display: flex;
  align-items: center;
  justify-content: center;
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
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(240, 246, 255, 0.48));
}

.stage-placeholder__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

.stage-placeholder__desc {
  max-width: 420px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}

.stage-overlay {
  position: absolute;
  left: 16px;
  bottom: 16px;
}

.overlay-pill,
.stage-badge,
.status-pill,
.clone-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.overlay-pill,
.stage-badge {
  gap: 6px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: var(--text-secondary);
}

.stage-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-pill--idle,
.clone-pill--not_started {
  background: #f1f5f9;
  color: #64748b;
}

.status-pill--connecting,
.clone-pill--pending,
.clone-pill--training,
.stage-badge--connecting {
  background: #fff7ed;
  color: #c2410c;
}

.status-pill--connected,
.clone-pill--ready,
.stage-badge--connected {
  background: #ecfdf5;
  color: #15803d;
}

.status-pill--mock,
.stage-badge--mock {
  background: var(--primary-bg);
  color: var(--primary);
}

.status-pill--error,
.clone-pill--failed,
.stage-badge--error {
  background: #fef2f2;
  color: #b91c1c;
}

.config-panel {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-section {
  padding: 14px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.section-header h4 {
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

.metric-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  min-height: 40px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
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

@media (max-width: 1180px) {
  .workspace-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .config-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .digital-workspace {
    margin: 10px 12px 0;
  }

  .stage-panel,
  .config-panel {
    padding: 14px;
    border-radius: 16px;
  }

  .stage-title-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .stage-copy h3 {
    font-size: 20px;
  }

  .digital-stage__frame {
    height: 300px;
    border-radius: 14px;
  }

  .config-panel {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
