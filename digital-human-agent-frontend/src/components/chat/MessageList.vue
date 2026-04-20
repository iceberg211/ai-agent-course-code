<template>
  <div class="message-list" ref="listEl" role="log" aria-live="polite" aria-label="对话记录">
    <!-- 骨架屏 -->
    <div v-if="loading" class="loading-list" role="status" aria-label="正在加载对话">
      <div v-for="i in 4" :key="i" class="loading-row" :class="{ right: i % 2 === 0 }">
        <span class="loading-avatar" />
        <span class="loading-bubble" :style="{ width: `${45 + (i * 7) % 20}%` }" />
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!messages.length" class="empty-state" role="status">
      <div class="empty-illustration">
        <div class="empty-ring ring-3" />
        <div class="empty-ring ring-2" />
        <div class="empty-ring ring-1" />
        <div class="empty-icon-wrap">
          <MessageCircleIcon :size="26" aria-hidden="true" />
        </div>
      </div>
      <p class="empty-title">开始对话</p>
      <p class="empty-desc">支持语音和文字输入<br>按住麦克风按钮开始说话</p>
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
import MessageItem from '@/components/chat/MessageItem.vue'
import type { ChatMessage } from '@/types'

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  loading: boolean
}>(), {
  messages: () => [],
  loading: false,
})

const listEl = ref<HTMLElement | null>(null)

watch(() => props.messages.length, () => {
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
})

defineExpose({ listEl })
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── 骨架屏 ──────────────────────────────────────────────────────── */
.loading-list {
  display: flex; flex-direction: column; gap: 16px; padding-top: 4px;
}
.loading-row {
  display: flex; align-items: center; gap: 10px;
}
.loading-row.right { flex-direction: row-reverse; }

.loading-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #dde8ff, #ccdcff);
}
.loading-bubble {
  height: 38px; border-radius: 14px;
  background: linear-gradient(90deg, #eef4ff 20%, #e2ecff 40%, #eef4ff 60%);
  background-size: 300% 100%;
  animation: shimmer 1.4s linear infinite;
}

@keyframes shimmer {
  0%   { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* ── 空态 ─────────────────────────────────────────────────────────── */
.empty-state {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 14px;
  padding-bottom: 24px;
}

.empty-illustration {
  position: relative;
  width: 80px; height: 80px;
  display: flex; align-items: center; justify-content: center;
}

.empty-ring {
  position: absolute;
  border-radius: 50%;
  border: 1.5px solid var(--primary-muted, #bfdbfe);
  animation: breathe-ring 3s ease-in-out infinite;
}
.ring-1 { width: 48px; height: 48px; animation-delay: 0s; }
.ring-2 { width: 64px; height: 64px; animation-delay: 0.3s; opacity: 0.6; }
.ring-3 { width: 80px; height: 80px; animation-delay: 0.6s; opacity: 0.3; }

@keyframes breathe-ring {
  0%, 100% { transform: scale(1);    opacity: inherit; }
  50%       { transform: scale(1.05); opacity: 0.4; }
}

.empty-icon-wrap {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--primary-bg, #eff6ff);
  border: 1.5px solid var(--primary-muted, #bfdbfe);
  display: flex; align-items: center; justify-content: center;
  color: var(--primary, #2563eb);
  position: relative;
  z-index: 1;
}

.empty-title {
  font-size: 16px; font-weight: 700; color: var(--text, #0f172a);
  letter-spacing: -0.02em;
}
.empty-desc {
  font-size: 13px; color: var(--text-muted, #64748b);
  text-align: center; line-height: 1.6;
}
</style>

