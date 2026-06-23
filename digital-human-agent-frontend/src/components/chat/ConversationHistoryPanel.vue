<template>
  <aside class="history-panel" aria-label="历史会话">
    <header>
      <span>会话列表</span>
      <button type="button" title="刷新历史会话" @click="load">
        <RefreshCwIcon :size="13" />
      </button>
    </header>
    <button class="new-btn" type="button" @click="$emit('newConversation')">
      <PlusIcon :size="14" />
      新对话
    </button>
    <ol v-if="items.length" class="history-list">
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          :class="{ active: item.id === currentConversationId }"
          @click="selectConversation(item.id)"
        >
          <strong>{{ titleOf(item) }}</strong>
          <span>{{ formatDate(item.updatedAt) }}</span>
        </button>
      </li>
    </ol>
    <p v-else class="empty">暂无历史会话</p>
  </aside>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { PlusIcon, RefreshCwIcon } from 'lucide-vue-next'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import type { ChatMessage, ConversationSummary } from '@/types'

const props = defineProps<{
  personaId: string
  currentConversationId: string
}>()

const emit = defineEmits<{
  select: [payload: { conversationId: string; messages: ChatMessage[] }]
  newConversation: []
}>()

const api = useProductizedKnowledge()
const items = ref<ConversationSummary[]>([])

onMounted(load)
watch(() => props.personaId, load)

async function load() {
  if (!props.personaId) {
    items.value = []
    return
  }
  const res = await api.listConversations({
    personaId: props.personaId,
    pageSize: 12,
  })
  items.value = res.items
}

async function selectConversation(conversationId: string) {
  const messages = await api.listConversationMessages(conversationId)
  emit('select', { conversationId, messages })
}

function titleOf(item: ConversationSummary) {
  const text = item.lastMessage?.content?.trim()
  return text ? text.slice(0, 40) : '新会话'
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.history-panel {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-right: 1px solid var(--border);
  background: var(--surface-soft);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 800;
}
header button,
.new-btn,
.history-list button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-secondary);
}
header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}
.new-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  color: var(--primary);
  font-weight: 800;
}
.history-list {
  list-style: none;
  display: grid;
  gap: 8px;
  overflow: auto;
}
.history-list button {
  width: 100%;
  display: grid;
  gap: 4px;
  padding: 10px;
  text-align: left;
}
.history-list button.active,
.history-list button:hover {
  border-color: rgba(59, 130, 246, 0.28);
  background: var(--primary-bg);
}
.history-list strong,
.history-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-list strong {
  color: var(--text);
}
.history-list span,
.empty {
  color: var(--text-muted);
  font-size: 12px;
}
@media (max-width: 1180px) {
  .history-panel {
    display: none;
  }
}
</style>
