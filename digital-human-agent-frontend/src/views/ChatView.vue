<template>
  <div class="app-shell">
    <!-- 左侧角色面板：直接从 personaStore / voiceClone 取数据 -->
    <PersonaPanel
      :personas="personaStore.personas"
      :selected-id="personaStore.selectedId"
      :selected-persona="personaStore.selectedPersona"
      :connected="sessionStore.connected"
      :loading="personaStore.loading"
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
        :docs-open="docsOpen"
        :mode="mode"
        @toggle-docs="docsOpen = !docsOpen"
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

    <!-- 右侧知识库抽屉：直接从 knowledge 取 -->
    <Transition name="slide-drawer">
      <DocsDrawer
        v-if="docsOpen"
        :persona-id="personaStore.selectedId"
        :documents="knowledgeDocuments"
        :uploading="knowledgeUploading"
        :loading="knowledgeLoading"
        :searching="knowledgeSearching"
        :search-result="knowledgeSearchResult"
        :status-label="knowledgeStatusLabel"
        @close="docsOpen = false"
        @upload="onUpload"
        @delete="onDeleteDoc"
        @search="onSearchKnowledge"
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
import { useAppController } from '../hooks/useAppController'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
import PersonaPanel from '../components/persona/PersonaPanel.vue'
import ChatHeader from '../components/chat/ChatHeader.vue'
import MessageList from '../components/chat/MessageList.vue'
import ChatComposer from '../components/chat/ChatComposer.vue'
import ChatControls from '../components/chat/ChatControls.vue'
import DocsDrawer from '../components/knowledge/DocsDrawer.vue'
import ToastAlert from '../components/common/ToastAlert.vue'
import PersonaCreateModal from '../components/persona/PersonaCreateModal.vue'
import type { Persona } from '../types'

// ── Stores（子组件直接消费，无需透传）────────────────────────────────────────
const personaStore = usePersonaStore()
const sessionStore = useSessionStore()

// ── AppController：仅获取操作句柄 + ref 绑定接口 ────────────────────────────
const {
  conversation,
  knowledge,
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
  onUpload,
  onDeleteDoc,
  onSearchKnowledge,
  onUploadVoiceSample,
  onRefreshVoiceCloneStatus,
} = useAppController()

// 从 useAppController 返回的同一套 Hook 派生模板绑定的 computed
const conversationMessages = computed(() => conversation.messages.value)
const conversationState = computed(() => conversation.state.value)
const knowledgeDocuments = computed(() => knowledge.documents.value)
const knowledgeUploading = computed(() => knowledge.uploading.value)
const knowledgeLoading = computed(() => knowledge.loading.value)
const knowledgeSearching = computed(() => knowledge.searching.value)
const knowledgeSearchResult = computed(() => knowledge.searchResult.value)
const knowledgeStatusLabel = computed(() => knowledge.statusLabel)
const voiceCloneState = computed(() => voiceClone.state.value)
const voiceCloneLoading = computed(() => voiceClone.loading.value)
const voiceCloneUploading = computed(() => voiceClone.uploading.value)

// ── Template refs ─────────────────────────────────────────────────────────────
const audioEl = ref<HTMLAudioElement | null>(null)
const digitalVideoEl = ref<HTMLVideoElement | null>(null)
const docsOpen = ref(false)
const createModalOpen = ref(false)

function onPersonaCreated(persona: Persona) {
  createModalOpen.value = false
  onSelectPersona(persona.id)
}

watch(audioEl, (el) => audio.initAudioElement(el))
watch(digitalVideoEl, (el) => digitalHuman.bindVideo(el))

const digitalHumanStatus = computed(() => digitalHuman.status.value)
const digitalHumanError = computed(() => digitalHuman.lastError.value)

// ── 工具函数 ──────────────────────────────────────────────────────────────────
const statusMap: Record<string, string> = {
  idle: '待命', connecting: '连接中', connected: '已连接', mock: 'Mock', error: '异常',
}
function formatDigitalStatus(status: string) {
  return statusMap[status] ?? status
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
