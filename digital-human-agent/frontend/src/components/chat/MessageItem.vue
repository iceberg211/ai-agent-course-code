<template>
  <div class="message" :class="message.role">
    <div class="avatar" aria-hidden="true">
      <BotIcon v-if="message.role === 'assistant'" :size="13" />
      <UserIcon v-else :size="13" />
    </div>
    <div class="body">
      <div class="bubble" :class="{ streaming: message.streaming }">
        <TypingIndicator v-if="message.streaming && !message.content" />
        <span v-else>{{ message.content }}</span>
      </div>
      <CitationChips :citations="message.citations" />
    </div>
  </div>
</template>

<script setup>
import { BotIcon, UserIcon } from 'lucide-vue-next'
import TypingIndicator from './TypingIndicator.vue'
import CitationChips from './CitationChips.vue'

defineProps({
  message: { type: Object, required: true },
})
</script>

<style scoped>
.message {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  animation: fadeInUp 0.18s ease-out;
}
.message.user { flex-direction: row-reverse; }

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.user .avatar { background: linear-gradient(135deg, #C4B5FD, #7C3AED); color: #fff; }
.assistant .avatar { background: var(--primary-bg); border: 1px solid var(--border-muted); color: var(--primary); }

.body { display: flex; flex-direction: column; gap: 4px; max-width: 70%; }
.user .body { align-items: flex-end; }
.assistant .body { align-items: flex-start; }

.bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: var(--shadow-sm);
}
.user .bubble { background: var(--user-bubble); color: #fff; border-bottom-right-radius: 4px; }
.assistant .bubble {
  background: var(--ai-bubble);
  color: var(--text);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-bottom-left-radius: 4px;
}
.assistant .bubble.streaming { border-left-color: var(--primary); }
</style>
