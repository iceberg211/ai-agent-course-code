<template>
  <div class="flex h-full relative overflow-hidden bg-slate-50/85 backdrop-blur-[20px] border border-white/60 rounded-3xl shadow-[0_24px_64px_rgba(15,23,42,0.08),0_4px_16px_rgba(15,23,42,0.04)] max-lg:rounded-2xl">
    <Transition name="sidebar">
      <div
        v-if="historySidebarOpen"
        class="w-[240px] shrink-0 h-full border-r border-slate-200/60 bg-white/35 overflow-hidden"
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
    <main class="flex-1 flex flex-col overflow-hidden bg-transparent">
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
        class="flex-1 min-h-0 flex"
        :class="mode === 'digital-human' ? 'flex-row gap-6 p-5 px-6 relative w-full overflow-hidden max-lg:flex-col max-lg:p-3.5 max-lg:px-4 max-lg:gap-5' : 'p-5 px-6'"
      >
        <!-- 数字人视频窗口（仅数字人模式下呈现在左侧） -->
        <DigitalHumanWorkspace
          v-if="mode === 'digital-human'"
          class="w-[340px] shrink-0 h-full transition-all duration-300 max-lg:w-full max-lg:h-[280px]"
          :class="{ 'max-[1300px]:w-[160px]': citationDrawerOpen || knowledgeDrawerOpen }"
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
        <div class="flex-1 flex flex-col min-h-0 relative w-full bg-white/75 backdrop-blur-[16px] rounded-3xl border border-slate-200/60 shadow-[0_8px_32px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] overflow-hidden">
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
            :suggested-questions="emptyStateCard.suggestedQuestions"
            @primary-action="runChatAction(emptyStateCard.primaryAction)"
            @secondary-action="runChatAction(emptyStateCard.secondaryAction)"
            @select-question="onSendText"
          />
          <MessageList
            v-else
            :messages="conversationMessages"
            :loading="sessionStore.historyLoading"
            class="flex-1 m-0 min-h-0 h-full p-4.5 px-5"
            @show-citation-detail="handleShowCitation"
            @regenerate="handleRegenerate"
          />

          <!-- 输入区：统一收纳于聊天控制台面板内底栏 -->
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
import ChatHeader from '@/components/chat/ChatHeader.vue'
import ChatEmptyState from '@/components/chat/ChatEmptyState.vue'
import DigitalHumanWorkspace from '@/components/chat/DigitalHumanWorkspace.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import MountedKnowledgeBaseDrawer from '@/components/knowledge-base/MountedKnowledgeBaseDrawer.vue'
import ToastAlert from '@/components/common/ToastAlert.vue'
import PersonaCreateModal from '@/components/persona/PersonaCreateModal.vue'
import CitationDetailDrawer from '@/components/chat/CitationDetailDrawer.vue'
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
  suggestedQuestions?: string[]
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
  return knowledgeBaseStore.current?.id === knowledgeId ? knowledgeBaseStore.current.name : ''
})

const hasMountedKnowledgeBases = computed(
  () => mountedKnowledgeBases.value.length > 0,
)

const knowledgeSummary = computed(() => {
  if (focusKnowledgeBaseId.value) {
    return `已锁定调试知识库「${focusKnowledgeBaseName.value || '加载中...'}」`
  }
  if (loadingMountedKnowledgeBases.value) {
    return '正在获取角色挂载的知识库…'
  }
  if (!hasMountedKnowledgeBases.value) {
    return '当前角色尚未挂载任何知识库，回答将仅依赖大模型内置知识。'
  }
  const names = mountedKnowledgeBases.value.map((kb) => kb.name).join('、')
  return `当前角色已挂载 ${mountedKnowledgeBases.value.length} 个知识库：${names}。回答将基于检索召回段融合。`
})

const knowledgeSummaryCompact = computed(() => {
  if (focusKnowledgeBaseId.value) {
    return `已锁定: ${focusKnowledgeBaseName.value || '...'}`
  }
  if (loadingMountedKnowledgeBases.value) return '正在获取...'
  if (!hasMountedKnowledgeBases.value) return '未挂载知识'
  return `挂载了 ${mountedKnowledgeBases.value.length} 个知识库`
})

const knowledgeSummaryTone = computed(() => {
  if (focusKnowledgeBaseId.value) return 'warning'
  if (!hasMountedKnowledgeBases.value) return 'default'
  return 'success'
})

const emptyStateCard = computed<ChatStateCard>(() => {
  const persona = personaStore.selectedPersona
  if (!persona) {
    return {
      eyebrow: '配置向导',
      title: '您好！欢迎使用企业级 RAG 智能助手',
      description: '要开始对话，请先在顶部左侧选择或新建一个专属于您的 AI 知识分身角色。',
      tone: 'warning',
      steps: ['① 在顶部选择预设的 AI 角色', '② 可在右侧面板为其挂载企业知识库文档', '③ 在底栏输入文字或点击麦克风开启通话'],
      primaryAction: {
        label: '立即新建专属知识角色',
        type: 'create-persona',
      },
      suggestedQuestions: [],
    }
  }

  if (focusKnowledgeBaseId.value) {
    return {
      eyebrow: '知识锁定调试模式',
      title: `正在验证知识库「${focusKnowledgeBaseName.value || '...'}」`,
      description: `系统已在 Query 参数中锁定了测试范围。当前所有的对话召回都物理限制在此单一知识库内。`,
      tone: 'active',
      capabilities: ['仅召回当前锁定知识库的分片', '不受角色默认挂载知识库范围干扰', '支持随时切换为数字人视频连线'],
      primaryAction: {
        label: '去知识库详情看文档',
        type: 'go-focus-knowledge-base',
      },
      suggestedQuestions: ['详细解释此知识库的解析流程', '分析向量初筛阶段的相似度过滤', '测试该文档的一跳图谱关联度'],
    }
  }

  if (!hasMountedKnowledgeBases.value) {
    return {
      eyebrow: '知识未挂载告警',
      title: `角色「${persona.name}」已就绪，但尚未关联企业知识`,
      description: '在没有挂载任何知识库文档的情况下，AI 的回答完全源自基座大模型的通识记忆。',
      tone: 'warning',
      steps: ['① 点击右侧的「知识库 (0)」展开设置', '② 勾选要关联的文档分类或具体知识库', '③ 返回此处输入您的问题即可使用 RAG 检索'],
      primaryAction: {
        label: '立即挂载知识库',
        type: 'open-knowledge-drawer',
      },
      secondaryAction: {
        label: '去管理所有知识库',
        type: 'go-knowledge-base',
      },
      suggestedQuestions: ['如何在线修改分片文本？', '向导式声纹克隆如何工作？'],
    }
  }

  return {
    eyebrow: 'RAG 检索增强已就绪',
    title: `与「${persona.name}」开始多模态对话`,
    description: `系统已为您关联了 ${mountedKnowledgeBases.value.length} 个核心企业知识库（例如：${mountedKnowledgeBases.value.slice(0,2).map(k=>k.name).join('、')}${mountedKnowledgeBases.value.length > 2 ? ' 等' : ''}）。`,
    tone: 'success',
    capabilities: ['支持音视频连线，大模型在 1.2s 内低延迟应答', '支持 RRF 检索融合与 Rerank 语义重排', '支持溯源追溯与引用文档段落展示'],
    suggestedQuestions: ['检索召回率如何调优？', '混合检索RRF的分数是如何计算的？', 'Neo4j图谱一跳关联是如何召回的？'],
  }
})

function runChatAction(act?: ChatAction) {
  if (!act) return
  if (act.type === 'create-persona') {
    createModalOpen.value = true
  } else if (act.type === 'open-knowledge-drawer') {
    knowledgeDrawerOpen.value = true
  } else if (act.type === 'go-knowledge-base') {
    router.push('/kb')
  } else if (act.type === 'go-focus-knowledge-base') {
    if (focusKnowledgeBaseId.value) {
      router.push(`/kb/${focusKnowledgeBaseId.value}`)
    }
  }
}

async function refreshMountedKnowledgeBases(personaId?: string) {
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

// 监听锁定知识库载入
watch(
  () => focusKnowledgeBaseId.value,
  (id) => {
    if (id) {
      void knowledgeBaseHook.getById(id).then((res) => {
        if (res) {
          knowledgeBaseStore.setCurrent(res)
          knowledgeBaseStore.upsert(res)
        }
      })
    }
  },
  { immediate: true },
)

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

watch(audioEl, (el) => {
  if (el) {
    audio.initAudioElement(el)
    digitalHuman.bindAudio(el)
  }
})
</script>

<style scoped>
/* 侧边栏进出动画 */
.sidebar-enter-active {
  transition: width 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.1), opacity 0.2s ease;
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

/* 知识库抽屉滑入动画 */
.slide-drawer-enter-active {
  transition: transform 300ms cubic-bezier(0.175, 0.885, 0.32, 1.1), opacity 200ms ease-out;
}
.slide-drawer-leave-active {
  transition: transform 200ms ease-in, opacity 180ms ease-in;
}
.slide-drawer-enter-from,
.slide-drawer-leave-to {
  transform: translateX(30px);
  opacity: 0;
}

/* 数字人输入框深度选择适配，确保其在底栏边界完美吻合 */
.chat-content-pane :deep(.composer-wrap) {
  padding: 10px 20px 16px;
  border-top: 1px solid var(--border-muted);
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.chat-content-pane :deep(.composer-pill) {
  max-width: 100%;
}
</style>
