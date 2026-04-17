<template>
  <nav class="persona-panel" aria-label="角色列表">
    <div class="panel-header">
      <BotIcon :size="16" color="var(--primary)" aria-hidden="true" />
      <span class="logo">数字人 Agent</span>
    </div>

    <div class="section-row">
      <div class="section-label">角色</div>
      <button class="add-btn" type="button" @click="$emit('create')" aria-label="新建角色" title="新建角色">
        <PlusIcon :size="13" />
      </button>
    </div>

    <ul class="persona-list" role="listbox" aria-label="选择角色">
      <template v-if="loading">
        <li v-for="i in 4" :key="`skeleton-${i}`" class="persona-skeleton" aria-hidden="true">
          <span class="skeleton-avatar" />
          <span class="skeleton-lines">
            <span class="line line-main" />
            <span class="line line-sub" />
          </span>
        </li>
      </template>
      <template v-else>
        <PersonaItem
          v-for="p in personas"
          :key="p.id"
          :persona="p"
          :active="selectedId === p.id"
          @select="$emit('select', $event)"
          @delete="$emit('delete', $event)"
          @manage-kb="openKbModal"
        />
      </template>
      <li v-if="!loading && !personas.length" class="empty-hint" role="status">
        <UserIcon :size="16" color="var(--text-muted)" aria-hidden="true" />
        <span>暂无角色</span>
      </li>
    </ul>

    <section v-if="selectedPersona" class="clone-card" aria-label="语音克隆">
      <div class="clone-title">语音克隆</div>
      <div class="clone-row">
        <span class="clone-label">状态</span>
        <span class="clone-status" :class="cloneStatusClass">
          {{ cloneStatusLabel }}
        </span>
      </div>
      <div class="clone-row" v-if="voiceCloneState?.voiceId">
        <span class="clone-label">音色 ID</span>
        <span class="clone-value" :title="voiceCloneState.voiceId">{{ voiceCloneState.voiceId }}</span>
      </div>
      <div class="clone-actions">
        <button
          class="clone-btn"
          type="button"
          :disabled="voiceCloneUploading"
          @click="openFilePicker"
        >
          {{ voiceCloneUploading ? '上传中' : '上传样本' }}
        </button>
        <button
          class="clone-btn light"
          type="button"
          :disabled="voiceCloneLoading"
          @click="$emit('refresh-voice-clone')"
        >
          刷新
        </button>
      </div>
      <p class="clone-tip">建议 3-10 分钟，wav/mp3/m4a/aac</p>
      <input
        ref="voiceInputEl"
        type="file"
        accept=".wav,.mp3,.m4a,.aac,audio/*"
        style="display:none"
        @change="onVoiceFileChange"
      />
    </section>

    <div class="panel-footer">
      <ConnectionStatus :connected="connected" />
    </div>

    <PersonaKbModal
      v-if="kbModalPersona"
      :persona-id="kbModalPersona.id"
      :persona-name="kbModalPersona.name"
      @close="kbModalPersona = null"
    />
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { BotIcon, UserIcon, PlusIcon } from 'lucide-vue-next'
import PersonaItem from './PersonaItem.vue'
import PersonaKbModal from './PersonaKbModal.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import type { Persona, VoiceCloneState } from '../../types'

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'delete', id: string): void
  (e: 'create'): void
  (e: 'upload-voice-sample', file: File): void
  (e: 'refresh-voice-clone'): void
}>()

const props = defineProps<{
  personas: Persona[]
  selectedId: string
  selectedPersona?: Persona
  connected: boolean
  loading: boolean
  voiceCloneState: VoiceCloneState | null
  voiceCloneLoading: boolean
  voiceCloneUploading: boolean
}>()

const voiceInputEl = ref<HTMLInputElement | null>(null)
const kbModalPersona = ref<Persona | null>(null)

const cloneStatusLabel = computed(() => {
  const status = props.voiceCloneState?.status ?? 'not_started'
  return {
    not_started: '未开始',
    pending: '排队中',
    training: '训练中',
    ready: '已就绪',
    failed: '失败',
  }[status] ?? status
})

const cloneStatusClass = computed(() => {
  const status = props.voiceCloneState?.status ?? 'not_started'
  return `status-${status}`
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

function openKbModal(persona: Persona) {
  kbModalPersona.value = persona
}
</script>

<style scoped>
.persona-panel {
  width: 236px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #f7faff, #f2f7ff);
  border-right: 1px solid var(--border-muted);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--border-muted);
}
.logo { font-size: 14px; font-weight: 700; color: var(--text-secondary); letter-spacing: -0.02em; }
.section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px 6px 16px;
}
.section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  text-transform: uppercase;
}
.add-btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid var(--border-muted);
  background: #fff;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}
.add-btn:hover {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}
.persona-list { flex: 1; overflow-y: auto; padding: 4px 8px; list-style: none; }
.empty-hint { display: flex; align-items: center; gap: 8px; padding: 16px; color: var(--text-muted); font-size: 12px; list-style: none; }
.panel-footer { padding: 12px 16px; border-top: 1px solid var(--border-muted); }
.clone-card {
  margin: 6px 10px 0;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border-muted);
  background: #ffffff;
}
.clone-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}
.clone-row {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.clone-label {
  color: var(--text-muted);
}
.clone-value {
  color: var(--text);
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clone-status {
  padding: 1px 7px;
  border-radius: 10px;
  font-weight: 600;
}
.status-not_started { background: #f3f4f6; color: #6b7280; }
.status-pending { background: #fef3c7; color: #b45309; }
.status-training { background: #dbeafe; color: #1d4ed8; }
.status-ready { background: #dcfce7; color: #15803d; }
.status-failed { background: #fee2e2; color: #b91c1c; }
.clone-actions {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}
.clone-btn {
  flex: 1;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  padding: 5px 0;
  cursor: pointer;
}
.clone-btn.light {
  border-color: var(--border-muted);
  background: #fff;
  color: var(--text-secondary);
}
.clone-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.clone-tip {
  margin: 6px 0 0;
  font-size: 10px;
  color: var(--text-muted);
}
.persona-skeleton {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  list-style: none;
}
.skeleton-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(90deg, #e8f0ff 20%, #dbe8ff 45%, #e8f0ff 75%);
  background-size: 260% 100%;
  animation: shimmer 1.3s linear infinite;
}
.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.line {
  display: block;
  height: 9px;
  border-radius: 6px;
  background: linear-gradient(90deg, #edf3ff 20%, #dbe8ff 45%, #edf3ff 75%);
  background-size: 260% 100%;
  animation: shimmer 1.3s linear infinite;
}
.line-main { width: 72%; }
.line-sub { width: 52%; }

@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (max-width: 960px) {
  .persona-panel {
    width: 84px;
  }
  .panel-header {
    justify-content: center;
    padding: 14px 10px;
  }
  .logo,
  .section-label {
    display: none;
  }
  .persona-list {
    padding: 8px 6px;
  }
  .empty-hint {
    justify-content: center;
    padding: 10px 4px;
  }
  .empty-hint span {
    display: none;
  }
  .panel-footer {
    padding: 10px 8px;
  }
  .clone-card {
    margin: 6px;
    padding: 8px;
  }
  .clone-title,
  .clone-row,
  .clone-tip,
  .clone-actions {
    display: none;
  }
}
</style>
