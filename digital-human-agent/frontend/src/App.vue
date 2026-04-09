<template>
  <div class="app-shell">
    <!-- 左侧角色面板 -->
    <PersonaPanel
      :personas="personaStore.personas"
      :selected-id="personaStore.selectedId"
      :connected="sessionStore.connected"
      :loading="personaStore.loading"
      @select="onSelectPersona"
      @delete="onDeletePersona"
    />

    <!-- 中间对话区 -->
    <main class="chat-main">
      <ChatHeader
        :persona="personaStore.selectedPersona"
        :docs-open="docsOpen"
        @toggle-docs="docsOpen = !docsOpen"
      />
      <MessageList :messages="messages" :loading="historyLoading" />
      <ChatComposer
        :disabled="!personaStore.selectedId || !sessionStore.connected"
        :busy="historyLoading || state === 'thinking' || state === 'speaking' || state === 'recording'"
        @send="onSendText"
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
        :status-label="knowledge.statusLabel"
        @close="docsOpen = false"
        @upload="onUpload"
        @delete="onDeleteDoc"
      />
    </Transition>

    <!-- 全局 Toast -->
    <ToastAlert :message="toastMsg" />
  </div>
</template>

<script setup>
import { useAppController } from './hooks/useAppController.js'
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
  toastMsg,
  audioEl,
  messages,
  state,
  historyLoading,
  documents,
  uploading,
  knowledgeLoading,
  knowledge,
  onSelectPersona,
  onMicDown,
  onMicUp,
  onSendText,
  onUpload,
  onDeleteDoc,
  onDeletePersona,
} = useAppController()
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
