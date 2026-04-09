<template>
  <div class="message-list" ref="listEl" role="log" aria-live="polite" aria-label="对话记录">
    <!-- 空态 -->
    <div v-if="!messages.length" class="empty-state" role="status">
      <div class="empty-icon">
        <MessageCircleIcon :size="28" color="var(--primary-light)" aria-hidden="true" />
      </div>
      <p class="empty-title">开始对话</p>
      <p class="empty-desc">选择角色后，按住麦克风按钮说话</p>
    </div>

    <MessageItem
      v-for="msg in messages"
      :key="msg.id"
      :message="msg"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { MessageCircleIcon } from 'lucide-vue-next'
import MessageItem from './MessageItem.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
})

const listEl = ref(null)

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
