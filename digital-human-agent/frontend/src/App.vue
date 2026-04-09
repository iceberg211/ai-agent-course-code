<template>
  <div class="app-shell">
    <!-- 左侧角色面板 -->
    <PersonaPanel
      :personas="personaStore.personas"
      :selected-id="personaStore.selectedId"
      :connected="sessionStore.connected"
      @select="onSelectPersona"
    />

    <!-- 中间对话区 -->
    <main class="chat-main">
      <ChatHeader
        :persona="personaStore.selectedPersona"
        :docs-open="docsOpen"
        @toggle-docs="docsOpen = !docsOpen"
      />
      <MessageList :messages="conversation.messages" />
      <ChatControls
        :state="conversation.state"
        :disabled="!sessionStore.sessionId || !personaStore.selectedId"
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
        :documents="knowledge.documents"
        :uploading="knowledge.uploading"
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
import { ref, onMounted } from 'vue'
import { usePersonaStore } from './stores/persona.js'
import { useSessionStore } from './stores/session.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import { useAudio } from './hooks/useAudio.js'
import { useConversation } from './hooks/useConversation.js'
import { useKnowledge } from './hooks/useKnowledge.js'
import PersonaPanel from './components/persona/PersonaPanel.vue'
import ChatHeader from './components/chat/ChatHeader.vue'
import MessageList from './components/chat/MessageList.vue'
import ChatControls from './components/chat/ChatControls.vue'
import DocsDrawer from './components/knowledge/DocsDrawer.vue'
import ToastAlert from './components/common/ToastAlert.vue'

// ── Stores ────────────────────────────────────────────────────────────
const personaStore = usePersonaStore()
const sessionStore = useSessionStore()

// ── Hooks ─────────────────────────────────────────────────────────────
const { connect, send, sendBinary, on } = useWebSocket()
const audio = useAudio()
const conversation = useConversation()
const knowledge = useKnowledge()

// ── 局部状态 ──────────────────────────────────────────────────────────
const docsOpen  = ref(false)
const toastMsg  = ref('')
const audioEl   = ref(null)

// ── WebSocket 事件绑定 ────────────────────────────────────────────────
on('session:ready', (msg) => {
  sessionStore.setSession(msg.sessionId, msg.payload?.conversationId ?? '')
  knowledge.fetchDocuments(personaStore.selectedId)
})

on('asr:final', (msg) => {
  conversation.pushUserMessage(msg.payload.text)
})

on('conversation:start', (msg) => {
  conversation.startAssistantMessage(msg.turnId)
})

on('conversation:text_chunk', (msg) => {
  conversation.appendToken(msg.turnId, msg.payload.token)
})

on('conversation:done', (msg) => {
  conversation.finishAssistantMessage(msg.turnId)
  if (conversation.state.value === 'thinking') conversation.state.value = 'idle'
})

on('conversation:citations', (msg) => {
  conversation.setCitations(msg.turnId, msg.payload.citations)
})

on('tts:start', (msg) => {
  conversation.state.value = 'speaking'
  audio.onTtsStart(msg.turnId)
})

on('audio:chunk', (buffer) => {
  audio.onAudioChunk(buffer, audio.activeTurnId.get())
})

on('tts:end', () => {
  audio.onTtsEnd()
  if (conversation.state.value === 'speaking') conversation.state.value = 'idle'
})

on('error', (msg) => {
  showToast('⚠ ' + (msg.payload?.message ?? '发生错误'))
  conversation.state.value = 'idle'
})

// ── 角色选择 ──────────────────────────────────────────────────────────
function onSelectPersona(id) {
  if (id === personaStore.selectedId) return
  personaStore.select(id)
  conversation.clearMessages()
  send({ type: 'session:start', sessionId: '', payload: { personaId: id } })
}

// ── 麦克风 ────────────────────────────────────────────────────────────
async function onMicDown() {
  if (conversation.state.value === 'thinking' || conversation.state.value === 'speaking') {
    send({ type: 'conversation:interrupt', sessionId: sessionStore.sessionId })
    audio.stopPlayback()
    conversation.state.value = 'recording'
    await audio.startRecording()
    return
  }
  if (conversation.state.value !== 'idle') return
  conversation.state.value = 'recording'
  await audio.startRecording()
}

async function onMicUp() {
  if (conversation.state.value !== 'recording') return
  conversation.state.value = 'thinking'
  const buffer = await audio.stopRecording()
  sendBinary(buffer)
}

// ── 知识库 ────────────────────────────────────────────────────────────
async function onUpload(file) {
  showToast(`上传中：${file.name}`)
  const { ok } = await knowledge.uploadDocument(personaStore.selectedId, file)
  showToast(ok ? `✓ ${file.name} 上传成功` : '上传失败，请重试')
}

async function onDeleteDoc(docId) {
  if (!confirm('删除后相关向量也将同步清除，确认继续？')) return
  const { ok } = await knowledge.deleteDocument(personaStore.selectedId, docId)
  if (!ok) showToast('删除失败')
}

// ── 工具 ──────────────────────────────────────────────────────────────
let toastTimer = null
function showToast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 3500)
}

// ── 初始化 ────────────────────────────────────────────────────────────
onMounted(async () => {
  audio.initAudioElement(audioEl.value)
  connect()
  await personaStore.fetchPersonas()
})
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--primary-bg);
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
</style>
