<template>
  <div class="app-shell">
    <!-- 左侧角色面板 -->
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
      />
      <section v-if="mode === 'digital-human'" class="digital-stage" aria-label="数字人视频区">
        <video ref="digitalVideoEl" class="digital-video" autoplay playsinline muted />
        <div class="digital-mask">
          <div class="digital-status">数字人状态：{{ formatDigitalStatus(digitalHumanStatus) }}</div>
          <div v-if="digitalHumanError" class="digital-error">{{ digitalHumanError }}</div>
        </div>
      </section>
      <MessageList :messages="messages" :loading="historyLoading" />
      <ChatComposer
        :disabled="!personaStore.selectedId"
        :busy="historyLoading || state === 'thinking' || state === 'speaking' || state === 'recording'"
        :can-stop="state === 'thinking'"
        @send="onSendText"
        @stop="onStopText"
      />
      <ChatControls
        :state="state"
        :disabled="!personaStore.selectedId || !sessionStore.connected"
        @mic-down="onMicDown"
        @mic-up="onMicUp"
      />
      <audio ref="audioEl" style="display:none" aria-hidden="true" />
    </main>

    <!-- 右侧知识库抽屉 -->
    <Transition name="slide-drawer">
      <DocsDrawer
        v-if="docsOpen"
        :persona-id="personaStore.selectedId"
        :documents="documents"
        :uploading="uploading"
        :loading="knowledgeLoading"
        :searching="knowledgeSearching"
        :search-result="knowledgeSearchResult"
        :status-label="knowledge.statusLabel"
        @close="docsOpen = false"
        @upload="onUpload"
        @delete="onDeleteDoc"
        @search="onSearchKnowledge"
      />
    </Transition>

    <!-- 全局 Toast -->
    <ToastAlert :message="toastMsg" />
  </div>
</template>

<script setup lang="ts">
import { useAppController } from './hooks/useAppController'
import PersonaPanel from './components/persona/PersonaPanel.vue'
import ChatHeader from './components/chat/ChatHeader.vue'
import MessageList from './components/chat/MessageList.vue'
import ChatComposer from './components/chat/ChatComposer.vue'
import ChatControls from './components/chat/ChatControls.vue'
import DocsDrawer from './components/knowledge/DocsDrawer.vue'
import ToastAlert from './components/common/ToastAlert.vue'

const {
  personaStore,
  sessionStore,
  docsOpen,
  mode,
  toastMsg,
  audioEl,
  digitalVideoEl,
  messages,
  state,
  historyLoading,
  documents,
  uploading,
  knowledgeLoading,
  knowledgeSearching,
  knowledgeSearchResult,
  voiceCloneState,
  voiceCloneLoading,
  voiceCloneUploading,
  digitalHumanStatus,
  digitalHumanError,
  knowledge,
  onSelectPersona,
  onChangeMode,
  onMicDown,
  onMicUp,
  onSendText,
  onStopText,
  onUpload,
  onUploadVoiceSample,
  onRefreshVoiceCloneStatus,
  onDeleteDoc,
  onSearchKnowledge,
  onDeletePersona,
} = useAppController()

function formatDigitalStatus(status: string) {
  return {
    idle: '待命',
    connecting: '连接中',
    connected: '已连接',
    mock: 'Mock 模式',
    error: '异常',
  }[status] ?? status
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
.digital-stage {
  position: relative;
  margin: 12px 16px 0;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: radial-gradient(120% 140% at 20% 10%, #f7fbff, #edf4ff);
  min-height: 180px;
}
.digital-video {
  width: 100%;
  height: 220px;
  display: block;
  object-fit: cover;
  background: #e7eefb;
}
.digital-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 10px;
  background: linear-gradient(180deg, rgba(20, 31, 56, 0), rgba(20, 31, 56, 0.72));
  color: #fff;
  font-size: 12px;
}
.digital-error {
  margin-top: 2px;
  font-size: 11px;
  color: #ffd3d3;
}

/* 知识库抽屉滑入动画 */
.slide-drawer-enter-active { transition: transform 200ms ease-out, opacity 200ms ease-out; }
.slide-drawer-leave-active { transition: transform 180ms ease-in, opacity 180ms ease-in; }
.slide-drawer-enter-from, .slide-drawer-leave-to { transform: translateX(20px); opacity: 0; }

@media (max-width: 1024px) {
  .app-shell {
    border-radius: 14px;
  }
}
</style>
