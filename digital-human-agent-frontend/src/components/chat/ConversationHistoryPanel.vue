<template>
  <aside ref="panelEl" class="history-panel" aria-label="历史会话">
    <!-- 顶部角色选择下拉切换器 -->
    <div class="persona-selector">
      <button
        class="persona-trigger"
        type="button"
        aria-haspopup="listbox"
        :aria-expanded="isPopoverOpen"
        @click="isPopoverOpen = !isPopoverOpen"
      >
        <div class="persona-trigger__avatar">
          {{ personaStore.selectedPersona?.name?.[0] || '?' }}
        </div>
        <div class="persona-trigger__info">
          <span class="persona-trigger__name">
            {{ personaStore.selectedPersona?.name || '选择知识助手' }}
          </span>
          <span class="persona-trigger__sub">切换角色</span>
        </div>
        <ChevronDownIcon :size="14" class="persona-trigger__chevron" :class="{ open: isPopoverOpen }" />
      </button>

      <!-- 浮层角色选择列表 -->
      <Transition name="fade-popover">
        <div v-if="isPopoverOpen" class="persona-popover" role="listbox">
          <header class="popover-head">
            <span>选择知识助手</span>
          </header>
          
          <ul class="popover-list">
            <li
              v-for="p in personaStore.personas"
              :key="p.id"
              class="popover-item"
              :class="{ 'popover-item--active': p.id === personaId }"
              role="option"
              :aria-selected="p.id === personaId"
              @click="selectPersona(p.id)"
            >
              <div class="popover-item__avatar">{{ p.name[0] }}</div>
              <div class="popover-item__info">
                <strong>{{ p.name }}</strong>
                <p v-if="p.description" :title="p.description">{{ p.description }}</p>
              </div>
              <button
                class="popover-item__delete"
                type="button"
                aria-label="删除角色"
                title="删除角色"
                @click.stop="deletePersona(p.id)"
              >
                <Trash2Icon :size="13" />
              </button>
            </li>
          </ul>

          <button class="popover-add-btn" type="button" @click="createPersona">
            <PlusIcon :size="14" />
            <span>新建角色</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- 中部会话列表控制器 -->
    <div class="history-ctrl">
      <div class="ctrl-header">
        <span>会话历史</span>
        <button class="icon-btn" type="button" title="刷新历史会话" @click="load">
          <RefreshCwIcon :size="12" />
        </button>
      </div>
      <button class="new-chat-btn" type="button" @click="$emit('newConversation')">
        <PlusIcon :size="14" />
        <span>新对话</span>
      </button>
    </div>

    <!-- 纵向滚动的会话项列表 -->
    <ol v-if="items.length" class="history-list">
      <li v-for="item in items" :key="item.id" class="history-item">
        <button
          class="history-item-btn"
          type="button"
          :class="{ active: item.id === currentConversationId }"
          @click="selectConversation(item.id)"
        >
          <span class="chat-icon">💬</span>
          <div class="history-item-copy">
            <strong :title="titleOf(item)">{{ titleOf(item) }}</strong>
            <span class="chat-time">{{ formatDate(item.updatedAt) }}</span>
          </div>
        </button>
      </li>
    </ol>
    <div v-else class="empty-state">
      <MessageSquareIcon :size="16" class="empty-icon" />
      <span>暂无会话历史</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ChevronDownIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import { usePersonaStore } from '@/stores/persona'
import type { ChatMessage, ConversationSummary } from '@/types'

const props = defineProps<{
  personaId: string
  currentConversationId: string
}>()

const emit = defineEmits<{
  select: [payload: { conversationId: string; messages: ChatMessage[] }]
  newConversation: []
  selectPersona: [id: string]
  deletePersona: [id: string]
  createPersona: []
}>()

const api = useProductizedKnowledge()
const personaStore = usePersonaStore()

const items = ref<ConversationSummary[]>([])
const isPopoverOpen = ref(false)
const panelEl = ref<HTMLElement | null>(null)

onMounted(() => {
  load()
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
})

watch(() => props.personaId, () => {
  load()
  isPopoverOpen.value = false
})

async function load() {
  if (!props.personaId) {
    items.value = []
    return
  }
  const res = await api.listConversations({
    personaId: props.personaId,
    pageSize: 15,
  })
  items.value = res.items
}

async function selectConversation(conversationId: string) {
  const messages = await api.listConversationMessages(conversationId)
  emit('select', { conversationId, messages })
}

function selectPersona(id: string) {
  emit('selectPersona', id)
  isPopoverOpen.value = false
}

function deletePersona(id: string) {
  emit('deletePersona', id)
}

function createPersona() {
  emit('createPersona')
  isPopoverOpen.value = false
}

function handleGlobalClick(e: MouseEvent) {
  if (panelEl.value && !panelEl.value.contains(e.target as Node)) {
    isPopoverOpen.value = false
  }
}

function titleOf(item: ConversationSummary) {
  const text = item.lastMessage?.content?.trim()
  return text ? text : '新会话'
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.history-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 14px;
  background: transparent;
}

/* 角色下拉切换器容器 */
.persona-selector {
  position: relative;
  margin-bottom: 18px;
}

.persona-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.02);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s var(--ease-out);
}

.persona-trigger:hover {
  background: #ffffff;
  border-color: var(--primary-muted);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.06);
}

.persona-trigger__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}

.persona-trigger__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.persona-trigger__name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.persona-trigger__sub {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--text-muted);
}

.persona-trigger__chevron {
  color: var(--text-muted);
  transition: transform 0.25s ease;
}

.persona-trigger__chevron.open {
  transform: rotate(180deg);
}

/* 角色 Popover 浮层 */
.persona-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 100;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 
    0 16px 36px rgba(15, 23, 42, 0.12),
    0 4px 12px rgba(15, 23, 42, 0.04);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.popover-head {
  padding: 4px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.popover-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popover-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  border: 1px solid transparent;
}

.popover-item:hover {
  background: rgba(59, 130, 246, 0.04);
  border-color: rgba(59, 130, 246, 0.1);
}

.popover-item--active {
  background: var(--primary-bg) !important;
  border-color: rgba(191, 219, 254, 0.6) !important;
}

.popover-item__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #93c5fd, #3b82f6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  flex-shrink: 0;
}

.popover-item__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.popover-item__info strong {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
}

.popover-item__info p {
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.popover-item__delete {
  opacity: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: #fff;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.popover-item:hover .popover-item__delete {
  opacity: 1;
}

.popover-item__delete:hover {
  background: #fef2f2;
  color: var(--error);
  border-color: rgba(239, 68, 68, 0.25);
}

.popover-add-btn {
  width: 100%;
  height: 34px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.popover-add-btn:hover {
  border-style: solid;
  border-color: var(--primary-muted);
  background: var(--primary-bg);
  color: var(--primary);
}

/* 历史控制栏 */
.history-ctrl {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.ctrl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.ctrl-header span {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.icon-btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.6);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: var(--primary-bg);
  color: var(--primary);
}

.new-chat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  border: 1px solid rgba(59, 130, 246, 0.18);
  border-radius: var(--radius-md);
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.new-chat-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
  box-shadow: var(--shadow-btn);
}

.new-chat-btn:active {
  transform: scale(0.97);
}

/* 会话列表 */
.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
}

.history-item-btn {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(226, 232, 240, 0.5);
  background: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s var(--ease-out);
}

.history-item-btn:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(59, 130, 246, 0.2);
}

.history-item-btn.active {
  background: #ffffff !important;
  border-color: var(--primary) !important;
  box-shadow: 
    0 4px 12px rgba(59, 130, 246, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.chat-icon {
  font-size: 13px;
  margin-top: 1px;
}

.history-item-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-item-copy strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-btn.active strong {
  color: var(--text);
}

.chat-time {
  font-size: 9.5px;
  color: var(--text-muted);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  border: 1px dashed rgba(226, 232, 240, 0.6);
  border-radius: var(--radius-lg);
  margin-top: 10px;
}

.empty-icon {
  color: var(--text-muted);
}

/* Transiton 过渡 */
.fade-popover-enter-active,
.fade-popover-leave-active {
  transition: opacity 150ms ease, transform 150ms var(--ease-spring);
}

.fade-popover-enter-from,
.fade-popover-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
