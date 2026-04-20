<template>
  <header class="chat-header">
    <div class="persona-info">
      <template v-if="persona">
        <div class="avatar" aria-hidden="true">{{ persona.name[0] }}</div>
        <div class="persona-copy">
          <div class="name">{{ persona.name }}</div>
          <div class="sub" :class="subClass">{{ knowledgeSummary || '企业知识问答助手' }}</div>
        </div>
      </template>
      <span v-else class="hint">请从左侧选择角色</span>
    </div>

    <div class="header-actions">
      <div class="mode-switch" role="tablist" aria-label="会话模式">
        <button
          class="mode-btn"
          :class="{ active: mode === 'voice' }"
          role="tab"
          :aria-selected="mode === 'voice'"
          @click="$emit('change-mode', 'voice')"
        >
          语音
        </button>
        <button
          class="mode-btn"
          :class="{ active: mode === 'digital-human' }"
          role="tab"
          :aria-selected="mode === 'digital-human'"
          @click="$emit('change-mode', 'digital-human')"
        >
          数字人
        </button>
      </div>
      <button
        v-if="persona"
        class="header-btn"
        @click="$emit('new-conversation')"
        aria-label="新建对话"
        title="新建对话（清空当前会话）"
      >
        <PlusSquareIcon :size="15" aria-hidden="true" />
        <span>新对话</span>
      </button>
      <button
        class="header-btn"
        :class="{ active: knowledgeDrawerOpen }"
        @click="$emit('toggle-knowledge-drawer')"
        :aria-pressed="knowledgeDrawerOpen"
        aria-label="打开知识库挂载"
      >
        <BookOpenIcon :size="15" aria-hidden="true" />
        <span>挂载知识库</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenIcon, PlusSquareIcon } from 'lucide-vue-next'
const props = defineProps({
  persona: { type: Object, default: null },
  knowledgeDrawerOpen: { type: Boolean, default: false },
  mode: { type: String, default: 'voice' },
  knowledgeSummary: { type: String, default: '' },
  knowledgeSummaryTone: { type: String, default: 'default' },
})
defineEmits(['toggle-knowledge-drawer', 'change-mode', 'new-conversation'])

const subClass = computed(() => ({
  'sub--warning': props.knowledgeSummaryTone === 'warning',
  'sub--active': props.knowledgeSummaryTone === 'active',
}))
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
.persona-copy { min-width: 0; }
.hint { font-size: 13px; color: var(--text-muted); }

.avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #87b4ff, #1f6feb);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff;
}
.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub  {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(44vw, 420px);
}
.sub--warning { color: #b45309; }
.sub--active { color: var(--primary); }

.header-btn {
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
.header-btn:hover { background: var(--primary-bg); border-color: var(--primary-muted); color: var(--primary); }
.header-btn.active { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); }
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mode-switch {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px;
  background: #fff;
}
.mode-btn {
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease-out;
}
.mode-btn.active {
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 600;
}

@media (max-width: 960px) {
  .chat-header {
    padding: 10px 12px;
  }
  .sub {
    display: none;
  }
  .header-btn {
    padding: 6px 10px;
  }
  .mode-btn {
    padding: 4px 8px;
  }
}
</style>
