<template>
  <div class="app-shell">
    <!-- 左侧角色面板：直接从 personaStore / voiceClone 取数据 -->
    <PersonaPanel
      :personas="personaStore.personas"
      :selected-id="personaStore.selectedId"
      :connected="sessionStore.connected"
      :loading="personaStore.loading"
      @select="onSelectPersona"
      @delete="onDeletePersona"
      @create="createModalOpen = true"
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

      <DigitalHumanWorkspace
        v-if="mode === 'digital-human'"
        :bind-video="digitalHuman.bindVideo"
        :status="digitalHumanStatus"
        :error="digitalHumanError"
        :voice-clone-state="voiceCloneState"
        :voice-clone-loading="voiceCloneLoading"
        :voice-clone-uploading="voiceCloneUploading"
        @upload-voice-sample="onUploadVoiceSample"
        @refresh-voice-clone="onRefreshVoiceCloneStatus"
      />

      <!-- 消息列表：直接从 conversation 取 -->
      <MessageList :messages="conversationMessages" :loading="sessionStore.historyLoading" />

      <!-- 输入区 -->
      <ChatComposer
        :disabled="!personaStore.selectedId"
        :busy="sessionStore.historyLoading || conversationState === 'thinking' || conversationState === 'speaking' || conversationState === 'recording'"
        :can-stop="conversationState === 'thinking'"
        :voice-state="conversationState"
        :voice-preparing="micPreparing"
        :voice-disabled="!personaStore.selectedId || !sessionStore.connected"
        @send="onSendText"
        @stop="onStopText"
        @mic-toggle="() => onMicToggle(mode)"
      />

      <audio ref="audioEl" autoplay style="display:none" aria-hidden="true" />
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
import { useAppController } from '@/hooks/useAppController'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePersonaStore } from '@/stores/persona'
import { useSessionStore } from '@/stores/session'
import PersonaPanel from '@/components/persona/PersonaPanel.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import DigitalHumanWorkspace from '@/components/chat/DigitalHumanWorkspace.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
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
  onMicToggle,
  onSendText,
  onStopText,
  onUploadVoiceSample,
  onRefreshVoiceCloneStatus,
  micPreparing,
} = useAppController()

// 从 useAppController 返回的同一套 Hook 派生模板绑定的 computed
const conversationMessages = computed(() => conversation.messages.value)
const conversationState = computed(() => conversation.state.value)
const voiceCloneState = computed(() => voiceClone.state.value)
const voiceCloneLoading = computed(() => voiceClone.loading.value)
const voiceCloneUploading = computed(() => voiceClone.uploading.value)

// ── Template refs ─────────────────────────────────────────────────────────────
const audioEl = ref<HTMLAudioElement | null>(null)
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

watch(audioEl, (el) => {
  audio.initAudioElement(el)
  digitalHuman.bindAudio(el)
})
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
watch(
  mode,
  (nextMode) => {
    if (nextMode === 'digital-human' && personaStore.selectedId) {
      void onRefreshVoiceCloneStatus()
    }
  },
)

const digitalHumanStatus = computed(() => digitalHuman.status.value)
const digitalHumanError = computed(() => digitalHuman.lastError.value)
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
