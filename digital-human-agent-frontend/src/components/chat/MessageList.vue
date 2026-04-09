<template>
  <div class="message-list" ref="listEl" role="log" aria-live="polite" aria-label="对话记录">
    <div v-if="loading" class="loading-list" role="status" aria-label="正在加载对话">
      <div v-for="i in 4" :key="i" class="loading-row" :class="{ right: i % 2 === 0 }">
        <span class="loading-avatar" />
        <span class="loading-bubble" />
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!messages.length" class="empty-state" role="status">
      <div class="empty-icon">
        <MessageCircleIcon :size="28" color="var(--primary-light)" aria-hidden="true" />
      </div>
      <p class="empty-title">开始对话</p>
      <p class="empty-desc">支持语音和文字输入，开始你的第一句对话</p>
    </div>

    <template v-else>
      <MessageItem
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { MessageCircleIcon } from 'lucide-vue-next'
import MessageItem from './MessageItem.vue'
import type { ChatMessage } from '../../types'

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  loading: boolean
}>(), {
  messages: () => [],
  loading: false,
})

const listEl = ref<HTMLElement | null>(null)

// 新消息时自动滚到底部
watch(() => props.messages.length, () => {
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
})

// expose el 供外部直接滚动
defineExpose({ listEl })
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 8px;
}
.loading-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.loading-row.right {
  justify-content: flex-end;
}
.loading-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #d7e5ff, #c7dcff);
}
.loading-bubble {
  width: min(58%, 360px);
  height: 34px;
  border-radius: 12px;
  background: linear-gradient(90deg, #eef4ff 25%, #dde9fb 37%, #eef4ff 63%);
  background-size: 400% 100%;
  animation: shimmer 1.3s linear infinite;
}
@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding-top: 60px;
}
.empty-icon {
  width: 52px; height: 52px;
  border-radius: 50%;
  background: var(--primary-bg);
  border: 1px solid var(--border-muted);
  display: flex; align-items: center; justify-content: center;
}
.empty-title { font-size: 15px; font-weight: 600; color: var(--text); }
.empty-desc  { font-size: 13px; color: var(--text-muted); text-align: center; }
</style>
