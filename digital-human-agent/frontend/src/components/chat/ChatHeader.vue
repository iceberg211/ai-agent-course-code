<template>
  <header class="chat-header">
    <div class="persona-info">
      <template v-if="persona">
        <div class="avatar" aria-hidden="true">{{ persona.name[0] }}</div>
        <div>
          <div class="name">{{ persona.name }}</div>
          <div class="sub">AI 对话助手</div>
        </div>
      </template>
      <span v-else class="hint">请从左侧选择角色</span>
    </div>

    <button
      class="docs-btn"
      :class="{ active: docsOpen }"
      @click="$emit('toggle-docs')"
      :aria-pressed="docsOpen"
      aria-label="打开知识库管理"
    >
      <BookOpenIcon :size="15" aria-hidden="true" />
      <span>知识库</span>
    </button>
  </header>
</template>

<script setup lang="ts">
import { BookOpenIcon } from 'lucide-vue-next'
defineProps({
  persona:  { type: Object,  default: null },
  docsOpen: { type: Boolean, default: false },
})
defineEmits(['toggle-docs'])
</script>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  min-height: 56px;
}
.persona-info { display: flex; align-items: center; gap: 10px; }
.hint { font-size: 13px; color: var(--text-muted); }

.avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #87b4ff, #1f6feb);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff;
}
.name { font-size: 14px; font-weight: 600; color: var(--text); }
.sub  { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

.docs-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
  font-family: inherit;
}
.docs-btn:hover { background: var(--primary-bg); border-color: var(--primary-muted); color: var(--primary); }
.docs-btn.active { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); }

@media (max-width: 960px) {
  .chat-header {
    padding: 10px 12px;
  }
  .sub {
    display: none;
  }
  .docs-btn {
    padding: 6px 10px;
  }
}
</style>
