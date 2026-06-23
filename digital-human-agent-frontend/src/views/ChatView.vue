<template>
  <div class="app-shell">
    <Transition name="sidebar">
      <div
        v-if="historySidebarOpen"
        class="sidebar-wrapper"
      >
        <ConversationHistoryPanel
          :persona-id="personaStore.selectedId || ''"
          :current-conversation-id="sessionStore.conversationId || ''"
          @select="onSelectConversation"
          @new-conversation="onNewConversation"
        />
      </div>
    </Transition>

    <!-- 中间对话区 -->
    <main class="chat-main">
      <ChatHeader
        :sidebar-open="historySidebarOpen"
        :knowledge-drawer-open="knowledgeDrawerOpen"
        :mode="mode"
        :knowledge-summary="knowledgeSummary"
        :knowledge-summary-compact="knowledgeSummaryCompact"
        :knowledge-summary-tone="knowledgeSummaryTone"
        @toggle-sidebar="historySidebarOpen = !historySidebarOpen"
        @toggle-knowledge-drawer="knowledgeDrawerOpen = !knowledgeDrawerOpen"
        @change-mode="onChangeMode"
        @new-conversation="onNewConversation"
        @select-persona="onSelectPersona"
        @delete-persona="onDeletePersona"
        @create-persona="createModalOpen = true"
      />

      <div
        class="chat-body"
        :class="{
          'chat-body--digital': mode === 'digital-human',
          'chat-body--drawer-open': citationDrawerOpen || knowledgeDrawerOpen
        }"
      >
        <!-- 数字人视频窗口（仅数字人模式下呈现在左侧） -->
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

        <!-- 主体聊天记录与控制面板 -->
        <div class="chat-content-pane">
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
            @show-citation-detail="handleShowCitation"
            @regenerate="handleRegenerate"
          />

          <!-- 输入区：统一收纳于聊天控制台面板内底栏，建立一致的边界感 -->
          <ChatComposer
            :disabled="!personaStore.selectedId || !sessionStore.connected"
            :busy="sessionStore.historyLoading || conversationState === 'thinking' || conversationState === 'speaking' || conversationState === 'recording'"
            :can-stop="conversationState === 'thinking'"
            :voice-state="conversationState"
            :voice-preparing="micPreparing"
            :voice-disabled="!personaStore.selectedId || !sessionStore.connected"
            @send="onSendText"
            @stop="onStopText"
            @mic-toggle="() => onMicToggle(mode)"
          />
        </div>
      </div>

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

    <!-- 引用文献详情抽屉 -->
    <Transition name="slide-drawer">
      <CitationDetailDrawer
        v-if="citationDrawerOpen && activeCitation"
        :citation="activeCitation"
        @close="citationDrawerOpen = false"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppController } from '@/hooks/useAppController'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePersonaStore } from '@/stores/persona'
import { useSessionStore } from '@/stores/session'
import ConversationHistoryPanel from '@/components/chat/ConversationHistoryPanel.vue'
import type { Persona } from '@/types'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import ChatEmptyState from '@/components/chat/ChatEmptyState.vue'
import DigitalHumanWorkspace from '@/components/chat/DigitalHumanWorkspace.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import MountedKnowledgeBaseDrawer from '@/components/knowledge-base/MountedKnowledgeBaseDrawer.vue'
import ToastAlert from '@/components/common/ToastAlert.vue'
import PersonaCreateModal from '@/components/persona/PersonaCreateModal.vue'
import type { ChatMessage } from '@/types'
import CitationDetailDrawer from '@/components/chat/CitationDetailDrawer.vue'

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
  onSelectConversation,
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
const historySidebarOpen = ref(window.innerWidth > 1024)
const audioEl = ref<HTMLAudioElement | null>(null)
const knowledgeDrawerOpen = ref(false)
const activeCitation = ref<any | null>(null)
const citationDrawerOpen = ref(false)

function handleShowCitation(citation: any) {
  activeCitation.value = citation
  citationDrawerOpen.value = true
}

function handleRegenerate() {
  const userMsgs = conversationMessages.value.filter((m) => m.role === 'user')
  const lastUserMsg = userMsgs[userMsgs.length - 1]
  if (lastUserMsg) {
    const msgs = conversation.messages.value
    const lastMsgIdx = msgs.length - 1
    if (lastMsgIdx >= 0 && msgs[lastMsgIdx].role === 'assistant') {
      msgs.splice(lastMsgIdx, 1)
    }
    void onSendText(lastUserMsg.content)
  }
}
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

onMounted(() => {
  if (route.query.useSearchDraft === '1') {
    const raw = localStorage.getItem('__draft_rag_search')
    if (raw) {
      try {
        const draft = JSON.parse(raw)
        if (draft.query) {
          // 开启新会话以装载新的 RAG 上下文并触发回答
          onNewConversation()
          setTimeout(() => {
            void onSendText(draft.query)
            localStorage.removeItem('__draft_rag_search')
          }, 500)
        }
      } catch (e) {
        console.error('Failed to load search draft:', e)
      }
    }
  }
})

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
  background: rgba(248, 250, 252, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: var(--radius-xl);
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.08),
    0 4px 16px rgba(15, 23, 42, 0.04);
}

/* 侧边栏容器 */
.sidebar-wrapper {
  width: 240px;
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(255, 255, 255, 0.35);
  overflow: hidden;
}

/* 侧边栏进出动画 (ChatGPT 风格平滑推拉) */
.sidebar-enter-active {
  transition: width 0.28s var(--ease-spring), opacity 0.2s ease;
  overflow: hidden;
}

.sidebar-leave-active {
  transition: width 0.22s ease-in, opacity 0.18s ease-in;
  overflow: hidden;
}

.sidebar-enter-from,
.sidebar-leave-to {
  width: 0 !important;
  opacity: 0;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
}

.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 20px 24px;
}

.chat-content-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  width: 100%;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: var(--radius-xl);
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 
    0 8px 32px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  overflow: hidden;
}
/* 核心：数字人分栏独立滚动布局 */
.chat-body--digital {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 24px;
  padding: 20px 24px;
  position: relative;
  width: 100%;
  overflow: hidden;
}

/* 数字人视频容器：外层仅控制骨架，内部组件自行渲染磨砂与阴影，防止出现双层边框重影 */
.chat-body--digital .chat-body__stage {
  width: 340px;
  flex-shrink: 0;
  height: 100%;
  transition: width 0.3s var(--ease-spring);
}

/* 防挤压：当中屏（<1300px）且右侧抽屉拉出时，左侧数字人自动平滑收起至 160px，确保聊天气泡有足够宽度 */
@media (max-width: 1300px) {
  .chat-body--digital.chat-body--drawer-open .chat-body__stage {
    width: 160px;
  }
}

/* 数字人模式下的聊天控制台面板：完美复用卡片样式并限定高度 */
.chat-body--digital .chat-content-pane {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.chat-body--digital :deep(.message-list) {
  flex: 1;
  margin: 0;
  min-height: 0;
  height: 100%;
  padding: 16px 20px;
}

.chat-body--digital :deep(.chat-empty) {
  flex: 1;
  min-height: 0;
  margin: 0;
}

/* 适配内嵌在卡片底部的输入栏 */
.chat-content-pane :deep(.composer-wrap) {
  padding: 10px 20px 16px;
  border-top: 1px solid var(--border-muted);
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.chat-content-pane :deep(.composer-pill) {
  max-width: 100%; /* 卡片内部输入框占满宽度 */
}

/* ── 知识库抽屉滑入动画 ─────────────────────────────────────────────────────── */
.slide-drawer-enter-active {
  transition: transform 300ms var(--ease-spring), opacity 200ms ease-out;
}

.slide-drawer-leave-active {
  transition: transform 200ms ease-in, opacity 180ms ease-in;
}

.slide-drawer-enter-from,
.slide-drawer-leave-to {
  transform: translateX(30px);
  opacity: 0;
}

@media (max-width: 1024px) {
  .app-shell {
    border-radius: var(--radius-lg);
  }

  .chat-body--digital {
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    gap: 20px;
  }

  .chat-body--digital .chat-body__stage {
    width: 100%;
    height: 280px;
  }
}
</style>
