<template>
  <div
    ref="listEl"
    class="message-list"
    role="log"
    aria-live="polite"
    aria-label="对话记录"
    @scroll="onScroll"
  >
    <!-- 骨架屏 -->
    <div v-if="loading" class="loading-list" role="status" aria-label="正在加载对话">
      <div v-for="i in 4" :key="i" class="loading-row" :class="{ right: i % 2 === 0 }">
        <span class="loading-avatar" />
        <span class="loading-bubble" :style="{ width: `${45 + (i * 7) % 20}%` }" />
      </div>
    </div>

    <template v-else>
      <MessageItem
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
      />
    </template>

    <button
      v-if="showJumpButton"
      class="message-list__jump"
      type="button"
      @click="scrollToLatest('smooth')"
    >
      回到最新
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
const pinnedToBottom = ref(true)
const BOTTOM_THRESHOLD = 96

const messageTail = computed(() => {
  const lastMessage = props.messages[props.messages.length - 1]
  if (!lastMessage) return 'empty'
  return [
    props.messages.length,
    lastMessage.id,
    lastMessage.content.length,
    lastMessage.streaming ? 'streaming' : 'steady',
  ].join(':')
})

const showJumpButton = computed(
  () => props.messages.length > 0 && !props.loading && !pinnedToBottom.value,
)

function updatePinnedState() {
  const el = listEl.value
  if (!el) return
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  pinnedToBottom.value = distanceToBottom <= BOTTOM_THRESHOLD
}

function onScroll() {
  updatePinnedState()
}

function scrollToLatest(behavior: ScrollBehavior = 'auto') {
  const el = listEl.value
  if (!el) return
  el.scrollTo({
    top: el.scrollHeight,
    behavior,
  })
  pinnedToBottom.value = true
}

watch(messageTail, async () => {
  await nextTick()
  if (pinnedToBottom.value) {
    scrollToLatest('auto')
  } else {
    updatePinnedState()
  }
})

watch(() => props.loading, async (loading) => {
  if (!loading) {
    await nextTick()
    scrollToLatest('auto')
  }
})

onMounted(async () => {
  await nextTick()
  scrollToLatest('auto')
})

defineExpose({ listEl })
</script>

<style scoped>
.message-list {
  flex: 1;
  position: relative;
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

.message-list__jump {
  position: absolute;
  right: 24px;
  bottom: 18px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(37, 99, 235, 0.2);
  background: rgba(255, 255, 255, 0.94);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(8px);
}

.message-list__jump:hover {
  background: var(--primary);
  color: #fff;
}

@media (max-width: 720px) {
  .message-list {
    padding: 16px 14px 12px;
  }

  .message-list__jump {
    right: 14px;
    bottom: 14px;
  }
}
</style>
