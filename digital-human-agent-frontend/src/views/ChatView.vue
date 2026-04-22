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
        :knowledge-summary-compact="knowledgeSummaryCompact"
        :knowledge-summary-tone="knowledgeSummaryTone"
        @toggle-knowledge-drawer="knowledgeDrawerOpen = !knowledgeDrawerOpen"
        @change-mode="onChangeMode"
        @new-conversation="onNewConversation"
      />

      <div
        class="chat-body"
        :class="{ 'chat-body--digital': mode === 'digital-human' }"
      >
        <ChatEmptyState
          v-if="!sessionStore.historyLoading && conversationMessages.length === 0"
          :eyebrow="emptyStateCard.eyebrow"
          :title="emptyStateCard.title"
          :description="emptyStateCard.description"
          :tone="emptyStateCard.tone === 'active' ? 'success' : emptyStateCard.tone"
          :steps="emptyStateCard.steps"
          :capabilities="emptyStateCard.capabilities"
          :primary-action-label="emptyStateCard.primaryAction?.label"
          :secondary-action-label="emptyStateCard.secondaryAction?.label"
          @primary-action="runChatAction(emptyStateCard.primaryAction)"
          @secondary-action="runChatAction(emptyStateCard.secondaryAction)"
        />
        <MessageList
          v-else
          :messages="conversationMessages"
          :loading="sessionStore.historyLoading"
        />

        <DigitalHumanWorkspace
          v-if="mode === 'digital-human'"
          class="chat-body__stage"
          :bind-video="digitalHuman.bindVideo"
          :status="digitalHumanStatus"
          :error="digitalHumanError"
          :voice-clone-state="voiceCloneState"
          :voice-clone-loading="voiceCloneLoading"
          :voice-clone-uploading="voiceCloneUploading"
          @upload-voice-sample="onUploadVoiceSample"
          @refresh-voice-clone="onRefreshVoiceCloneStatus"
        />
      </div>

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
import { useRoute, useRouter } from 'vue-router'
import { useAppController } from '@/hooks/useAppController'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePersonaStore } from '@/stores/persona'
import { useSessionStore } from '@/stores/session'
import PersonaPanel from '@/components/persona/PersonaPanel.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import ChatEmptyState from '@/components/chat/ChatEmptyState.vue'
import DigitalHumanWorkspace from '@/components/chat/DigitalHumanWorkspace.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import MountedKnowledgeBaseDrawer from '@/components/knowledge-base/MountedKnowledgeBaseDrawer.vue'
import ToastAlert from '@/components/common/ToastAlert.vue'
import PersonaCreateModal from '@/components/persona/PersonaCreateModal.vue'
import type { Persona } from '@/types'

type ChatActionType =
  | 'create-persona'
  | 'open-knowledge-drawer'
  | 'go-knowledge-base'
  | 'go-focus-knowledge-base'

interface ChatAction {
  label: string
  type: ChatActionType
}

interface ChatStateCard {
  eyebrow: string
  title: string
  description: string
  tone: 'default' | 'warning' | 'success' | 'active'
  steps?: string[]
  capabilities?: string[]
  primaryAction?: ChatAction
  secondaryAction?: ChatAction
}

// ── Stores（子组件直接消费，无需透传）────────────────────────────────────────
const route = useRoute()
const router = useRouter()
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

const hasMountedKnowledgeBases = computed(
  () => mountedKnowledgeBases.value.length > 0,
)

const focusKnowledgeBaseMounted = computed(() => {
  const knowledgeId = focusKnowledgeBaseId.value
  if (!knowledgeId) return false
  return mountedKnowledgeBases.value.some((kb) => kb.id === knowledgeId)
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
    return focusKnowledgeBaseMounted.value ? 'active' : 'warning'
  }
  return hasMountedKnowledgeBases.value ? 'active' : 'warning'
})

const knowledgeSummaryCompact = computed(() => {
  if (!personaStore.selectedId) return ''
  if (loadingMountedKnowledgeBases.value) return '知识范围读取中'

  if (focusKnowledgeBaseId.value) {
    const focusName = focusKnowledgeBaseName.value || '目标知识库'
    return focusKnowledgeBaseMounted.value
      ? `验证：${focusName}`
      : `待挂载：${focusName}`
  }

  if (!hasMountedKnowledgeBases.value) return '未挂载知识库'
  if (mountedKnowledgeBases.value.length === 1) return mountedKnowledgeBases.value[0].name
  return `${mountedKnowledgeBases.value.length} 个知识库`
})

const emptyStateCard = computed<ChatStateCard>(() => {
  const persona = personaStore.selectedPersona
  const personaName = persona?.name || '当前角色'
  const focusName = focusKnowledgeBaseName.value || '目标知识库'

  if (!persona) {
    return {
      eyebrow: '开始使用',
      title: '先选择一个知识助手，再开始问答',
      description: '左侧可以直接选择已有角色，也可以先新建一个角色。选好后，再为它挂载知识库，就能开始文字或语音提问。',
      tone: 'default',
      steps: ['创建或选择角色', '为角色挂载知识库', '输入真实问题开始验证'],
      capabilities: ['知识问答', '语音提问', '数字人播报'],
      primaryAction: { label: '新建角色', type: 'create-persona' },
      secondaryAction: { label: '进入知识库', type: 'go-knowledge-base' },
    }
  }

  if (loadingMountedKnowledgeBases.value) {
    return {
      eyebrow: '准备中',
      title: `正在读取 ${personaName} 的知识范围`,
      description: '知识范围确认完成后，就可以直接开始第一轮问答。',
      tone: 'default',
      steps: ['读取角色信息', '确认知识范围', '准备问题'],
    }
  }

  if (focusKnowledgeBaseId.value && !focusKnowledgeBaseMounted.value) {
    return {
      eyebrow: '待完成验证',
      title: `${focusName} 还没有参与当前会话`,
      description: '你是从知识库工作区进入验证的，但目标知识库还没挂到当前角色。先完成挂载，再回来提问，结果才会准确。',
      tone: 'warning',
      steps: ['打开右侧知识范围', `挂载 ${focusName}`, '返回对话开始验证'],
      primaryAction: { label: '立即挂载', type: 'open-knowledge-drawer' },
      secondaryAction: { label: '查看知识库详情', type: 'go-focus-knowledge-base' },
    }
  }

  if (!hasMountedKnowledgeBases.value) {
    return {
      eyebrow: '下一步',
      title: `先为 ${personaName} 挂载知识库`,
      description: '角色已经准备好，但它还没有业务知识范围。挂载完成后，回答才会真正基于知识库内容生成。',
      tone: 'warning',
      steps: ['打开右侧知识范围', '选择需要挂载的知识库', '回到输入框开始提问'],
      primaryAction: { label: '挂载知识库', type: 'open-knowledge-drawer' },
      secondaryAction: { label: '进入知识库', type: 'go-knowledge-base' },
    }
  }

  return {
    eyebrow: '已就绪',
    title: `${personaName} 已准备好开始问答`,
    description: focusKnowledgeBaseId.value && focusKnowledgeBaseMounted.value
      ? `当前会话会优先用于验证 ${focusName} 的效果。你可以直接输入真实问题，观察回答和引用是否符合预期。`
      : '当前知识范围已经准备好，可以直接输入问题，也可以用语音或数字人模式验证表达效果。',
    tone: 'success',
    capabilities: [
      '文本提问',
      sessionStore.connected ? '语音提问' : '语音链路连接中',
      '数字人播报',
    ],
    primaryAction: { label: '管理知识范围', type: 'open-knowledge-drawer' },
    secondaryAction: focusKnowledgeBaseId.value
      ? { label: '查看知识库详情', type: 'go-focus-knowledge-base' }
      : undefined,
  }
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

function openKnowledgeBaseWorkspace() {
  if (focusKnowledgeBaseId.value) {
    void router.push(`/kb/${focusKnowledgeBaseId.value}`)
    return
  }
  void router.push('/kb')
}

function runChatAction(action?: ChatAction) {
  if (!action) return

  switch (action.type) {
    case 'create-persona':
      createModalOpen.value = true
      break
    case 'open-knowledge-drawer':
      knowledgeDrawerOpen.value = true
      break
    case 'go-focus-knowledge-base':
      if (focusKnowledgeBaseId.value) {
        void router.push(`/kb/${focusKnowledgeBaseId.value}`)
      } else {
        openKnowledgeBaseWorkspace()
      }
      break
    case 'go-knowledge-base':
      openKnowledgeBaseWorkspace()
      break
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

.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.chat-body--digital {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px 16px;
  padding: 12px 16px 0;
  align-items: start;
}

.chat-body--digital .chat-body__stage {
  grid-column: 2;
  grid-row: 1;
  align-self: start;
}

.chat-body--digital :deep(.message-list),
.chat-body--digital :deep(.chat-empty) {
  grid-column: 1 / -1;
  grid-row: 2;
  margin: 0;
  min-height: 0;
}

.chat-body--digital :deep(.message-list) {
  height: 100%;
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

  .chat-body--digital {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    padding: 10px 12px 0;
  }

  .chat-body--digital .chat-body__stage {
    grid-column: 1;
    grid-row: 1;
  }

  .chat-body--digital :deep(.message-list),
  .chat-body--digital :deep(.chat-empty) {
    grid-column: 1;
    grid-row: 2;
  }
}
</style>
