<template>
  <div class="app-shell">
    <!-- 左侧角色面板：直接从 personaStore / voiceClone 取数据 -->
    <PersonaPanel
      :personas="personaStore.personas"
      :selected-id="personaStore.selectedId"
      :selected-persona="personaStore.selectedPersona"
      :connected="sessionStore.connected"
      :loading="personaStore.loading"
      :mode="mode"
      :voice-clone-state="voiceCloneState"
      :voice-clone-loading="voiceCloneLoading"
      :voice-clone-uploading="voiceCloneUploading"
      @select="onSelectPersona"
      @delete="onDeletePersona"
      @create="createModalOpen = true"
      @upload-voice-sample="onUploadVoiceSample"
      @refresh-voice-clone="onRefreshVoiceCloneStatus"
    />

    <!-- 中间对话区 -->
    <main class="chat-main">
      <ChatHeader
        :persona="personaStore.selectedPersona"
        :knowledge-drawer-open="knowledgeDrawerOpen"
        :mode="mode"
        :knowledge-summary="knowledgeSummary"
        :knowledge-summary-tone="knowledgeSummaryTone"
        @toggle-knowledge-drawer="knowledgeDrawerOpen = !knowledgeDrawerOpen"
        @change-mode="onChangeMode"
        @new-conversation="onNewConversation"
      />

      <!-- 数字人视频区 -->
      <section v-if="mode === 'digital-human'" class="digital-stage" aria-label="数字人视频区">
        <video ref="digitalVideoEl" class="digital-video" autoplay playsinline />
        <div class="digital-mask">
          <div class="digital-badge" :class="digitalHumanStatus">
            <span class="badge-dot" />
            {{ formatDigitalStatus(digitalHumanStatus) }}
          </div>
          <div v-if="digitalHumanError" class="digital-error">{{ digitalHumanError }}</div>
        </div>
      </section>

      <!-- 消息列表：直接从 conversation 取 -->
      <MessageList :messages="conversationMessages" :loading="sessionStore.historyLoading" />

      <!-- 输入区 -->
      <ChatComposer
        :disabled="!personaStore.selectedId"
        :busy="sessionStore.historyLoading || conversationState === 'thinking' || conversationState === 'speaking' || conversationState === 'recording'"
        :can-stop="conversationState === 'thinking'"
        @send="onSendText"
        @stop="onStopText"
      />

      <!-- 控制栏 -->
      <ChatControls
        :state="conversationState"
        :disabled="!personaStore.selectedId || !sessionStore.connected"
        @mic-down="() => onMicDown(mode)"
        @mic-up="onMicUp"
      />

      <audio ref="audioEl" style="display:none" aria-hidden="true" />
    </main>

    <!-- 右侧知识库抽屉：展示当前角色已挂载的知识库 -->
    <Transition name="slide-drawer">
      <MountedKnowledgeBaseDrawer
        v-if="knowledgeDrawerOpen"
        :persona-id="personaStore.selectedId"
        :persona-name="personaStore.selectedPersona?.name"
        :focus-knowledge-base-id="focusKnowledgeBaseId"
        @changed="refreshMountedKnowledgeBases(personaStore.selectedId)"
        @close="knowledgeDrawerOpen = false"
      />
    </Transition>

    <!-- 全局 Toast -->
    <ToastAlert :message="toastMsg" />

    <!-- 新建角色 Modal -->
    <PersonaCreateModal
      v-if="createModalOpen"
      @created="onPersonaCreated"
      @cancel="createModalOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { DIGITAL_HUMAN_STATUS_LABELS } from '@/common/constants'
import { useAppController } from '@/hooks/useAppController'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePersonaStore } from '@/stores/persona'
import { useSessionStore } from '@/stores/session'
import PersonaPanel from '@/components/persona/PersonaPanel.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatControls from '@/components/chat/ChatControls.vue'
import MountedKnowledgeBaseDrawer from '@/components/knowledge-base/MountedKnowledgeBaseDrawer.vue'
import ToastAlert from '@/components/common/ToastAlert.vue'
import PersonaCreateModal from '@/components/persona/PersonaCreateModal.vue'
import type { Persona } from '@/types'

// ── Stores（子组件直接消费，无需透传）────────────────────────────────────────
const route = useRoute()
const knowledgeBaseHook = useKnowledgeBase()
const knowledgeBaseStore = useKnowledgeBaseStore()
const personaStore = usePersonaStore()
const sessionStore = useSessionStore()

// ── AppController：仅获取操作句柄 + ref 绑定接口 ────────────────────────────
const {
  conversation,
  voiceClone,
  toastMsg,
  audio,
  digitalHuman,
  mode,
  onSelectPersona,
  onDeletePersona,
  onChangeMode,
  onNewConversation,
  onMicDown,
  onMicUp,
  onSendText,
  onStopText,
  onUploadVoiceSample,
  onRefreshVoiceCloneStatus,
} = useAppController()

// 从 useAppController 返回的同一套 Hook 派生模板绑定的 computed
const conversationMessages = computed(() => conversation.messages.value)
const conversationState = computed(() => conversation.state.value)
const voiceCloneState = computed(() => voiceClone.state.value)
const voiceCloneLoading = computed(() => voiceClone.loading.value)
const voiceCloneUploading = computed(() => voiceClone.uploading.value)

// ── Template refs ─────────────────────────────────────────────────────────────
const audioEl = ref<HTMLAudioElement | null>(null)
const digitalVideoEl = ref<HTMLVideoElement | null>(null)
const knowledgeDrawerOpen = ref(false)
const createModalOpen = ref(false)
const mountedKnowledgeBases = ref<Array<{ id: string; name: string }>>([])
const loadingMountedKnowledgeBases = ref(false)

const focusKnowledgeBaseId = computed(() => {
  const value = route.query.knowledgeBaseId
  return typeof value === 'string' ? value : ''
})

const focusKnowledgeBaseName = computed(() => {
  const knowledgeId = focusKnowledgeBaseId.value
  if (!knowledgeId) return ''
  return knowledgeBaseStore.byId.get(knowledgeId)?.name
    ?? (knowledgeBaseStore.current?.id === knowledgeId ? knowledgeBaseStore.current.name : '')
})

const knowledgeSummary = computed(() => {
  if (!personaStore.selectedId) return '选择知识助手后开始问答'
  if (loadingMountedKnowledgeBases.value) return '正在读取知识范围…'

  const focusKnowledgeId = focusKnowledgeBaseId.value
  const mounted = mountedKnowledgeBases.value

  if (focusKnowledgeId) {
    const mountedTarget = mounted.find((kb) => kb.id === focusKnowledgeId)
    if (mountedTarget) return `当前正在验证：${mountedTarget.name}`
    if (focusKnowledgeBaseName.value) return `待挂载验证：${focusKnowledgeBaseName.value}`
    return '已从知识库工作区进入问答验证'
  }

  if (mounted.length === 0) return '当前未挂载知识库'
  if (mounted.length === 1) return `当前回答基于 1 个知识库：${mounted[0].name}`
  return `当前回答基于 ${mounted.length} 个知识库：${mounted[0].name} 等`
})

const knowledgeSummaryTone = computed(() => {
  if (!personaStore.selectedId || loadingMountedKnowledgeBases.value) return 'default'
  if (focusKnowledgeBaseId.value) {
    return mountedKnowledgeBases.value.some((kb) => kb.id === focusKnowledgeBaseId.value)
      ? 'active'
      : 'warning'
  }
  return mountedKnowledgeBases.value.length > 0 ? 'active' : 'warning'
})

function onPersonaCreated(persona: Persona) {
  createModalOpen.value = false
  onSelectPersona(persona.id)
}

async function refreshMountedKnowledgeBases(personaId: string) {
  if (!personaId) {
    mountedKnowledgeBases.value = []
    return
  }
  loadingMountedKnowledgeBases.value = true
  try {
    const list = await knowledgeBaseHook.listKbsForPersona(personaId)
    mountedKnowledgeBases.value = list.map((kb) => ({ id: kb.id, name: kb.name }))
  } finally {
    loadingMountedKnowledgeBases.value = false
  }
}

watch(audioEl, (el) => audio.initAudioElement(el))
watch(digitalVideoEl, (el) => digitalHuman.bindVideo(el))
watch(
  () => personaStore.selectedId,
  (personaId) => {
    void refreshMountedKnowledgeBases(personaId)
  },
  { immediate: true },
)
watch(
  () => route.query.openKnowledgeDrawer,
  (flag) => {
    if (flag === '1') knowledgeDrawerOpen.value = true
  },
  { immediate: true },
)

const digitalHumanStatus = computed(() => digitalHuman.status.value)
const digitalHumanError = computed(() => digitalHuman.lastError.value)

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function formatDigitalStatus(status: string) {
  return DIGITAL_HUMAN_STATUS_LABELS[status as keyof typeof DIGITAL_HUMAN_STATUS_LABELS] ?? status
}
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: var(--shadow-md);
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
}

/* ── 数字人视频区 ─────────────────────────────────────────────────────────── */
.digital-stage {
  position: relative;
  margin: 12px 16px 0;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: radial-gradient(120% 140% at 20% 10%, #f0f6ff, #e5efff);
  min-height: 180px;
  flex-shrink: 0;
}

.digital-video {
  width: 100%;
  height: 220px;
  display: block;
  object-fit: cover;
  background: #dde8f8;
}

.digital-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 14px;
  background: linear-gradient(180deg, transparent, rgba(10, 20, 40, 0.65));
  display: flex;
  align-items: center;
  gap: 10px;
}

.digital-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: rgba(255,255,255,0.15);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.2);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  opacity: 0.8;
  flex-shrink: 0;
}
.digital-badge.connected .badge-dot { background: #4ade80; opacity: 1; }
.digital-badge.connecting .badge-dot { background: #facc15; animation: blink 1s infinite; }
.digital-badge.error .badge-dot { background: #f87171; }

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.digital-error {
  font-size: 11px;
  color: rgba(255,200,200,0.9);
}

/* ── 知识库抽屉滑入动画 ─────────────────────────────────────────────────────── */
.slide-drawer-enter-active {
  transition: transform 220ms cubic-bezier(0.34, 1.26, 0.64, 1), opacity 180ms ease-out;
}
.slide-drawer-leave-active {
  transition: transform 180ms ease-in, opacity 160ms ease-in;
}
.slide-drawer-enter-from,
.slide-drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

@media (max-width: 1024px) {
  .app-shell {
    border-radius: 14px;
  }
}
</style>
