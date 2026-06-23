<template>
  <aside class="history-panel" aria-label="历史会话">
    <!-- 顶部控制栏 -->
    <div class="history-ctrl">
      <span class="ctrl-title">会话历史</span>
      <button class="icon-btn" type="button" title="刷新历史" @click="load">
        <RefreshCwIcon :size="12" />
      </button>
    </div>

    <!-- 新对话按钮 -->
    <button class="new-chat-btn" type="button" @click="$emit('new-conversation')">
      <PlusIcon :size="14" />
      <span>新对话</span>
    </button>

    <!-- 会话列表 -->
    <ol v-if="items.length" class="history-list">
      <li v-for="item in items" :key="item.id" class="history-item">
        <button
          class="history-item-btn"
          type="button"
          :class="{ active: item.id === currentConversationId }"
          @click="selectConversation(item.id)"
        >
          <MessageSquareIcon :size="13" class="chat-icon" />
          <div class="history-item-copy">
            <strong :title="titleOf(item)">{{ titleOf(item) }}</strong>
            <span class="chat-time">{{ formatDate(item.updatedAt) }}</span>
          </div>
        </button>
      </li>
    </ol>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <MessageSquareIcon :size="20" class="empty-icon" />
      <span>暂无会话历史</span>
      <span class="empty-hint">发送第一条消息后将自动保存</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { MessageSquareIcon, PlusIcon, RefreshCwIcon } from 'lucide-vue-next'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import type { ChatMessage, ConversationSummary } from '@/types'

const props = defineProps<{
  personaId: string
  currentConversationId: string
}>()

const emit = defineEmits<{
  select: [payload: { conversationId: string; messages: ChatMessage[] }]
  'new-conversation': []
}>()

const api = useProductizedKnowledge()
const items = ref<ConversationSummary[]>([])

onMounted(() => load())

watch(() => props.personaId, () => load())

async function load() {
  if (!props.personaId) {
    items.value = []
    return
  }
  const res = await api.listConversations({
    personaId: props.personaId,
    pageSize: 30,
  })
  items.value = res.items
}

async function selectConversation(conversationId: string) {
  const messages = await api.listConversationMessages(conversationId)
  emit('select', { conversationId, messages })
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
  padding: 14px 12px;
  gap: 10px;
  background: transparent;
  overflow: hidden;
}

/* 顶部控制栏 */
.history-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  flex-shrink: 0;
}

.ctrl-title {
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
  transition: background 0.2s ease, color 0.2s ease;
}

.icon-btn:hover {
  background: var(--primary-bg);
  color: var(--primary);
}

/* 新对话按钮 */
.new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: var(--radius-md);
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  font-family: inherit;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
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
  gap: 4px;
  overflow-y: auto;
  flex: 1;
}

.history-item-btn {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(226, 232, 240, 0.5);
  background: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
  font-family: inherit;
}

.history-item-btn:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(59, 130, 246, 0.2);
}

.history-item-btn.active {
  background: #ffffff !important;
  border-color: var(--primary) !important;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
}

.chat-icon {
  color: var(--text-muted);
  flex-shrink: 0;
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
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-btn.active strong {
  color: var(--text);
}

.chat-time {
  font-size: 10px;
  color: var(--text-muted);
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  border: 1px dashed rgba(226, 232, 240, 0.8);
  border-radius: var(--radius-lg);
  padding: 20px 12px;
}

.empty-icon {
  color: var(--text-muted);
  opacity: 0.5;
  margin-bottom: 4px;
}

.empty-hint {
  font-size: 10.5px;
  color: var(--text-muted);
  opacity: 0.7;
  text-align: center;
}
</style>
