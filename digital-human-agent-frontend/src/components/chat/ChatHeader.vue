<template>
  <header class="chat-header">
    <div class="persona-info">
      <template v-if="persona">
        <div class="avatar" aria-hidden="true">{{ persona.name[0] }}</div>
        <div class="persona-copy">
          <div class="name-row">
            <div class="name">{{ persona.name }}</div>
            <span
              v-if="knowledgeSummaryCompact"
              class="summary-pill"
              :class="summaryClass"
              :title="knowledgeSummary"
            >
              <BookOpenIcon :size="12" aria-hidden="true" />
              <span>{{ knowledgeSummaryCompact }}</span>
            </span>
          </div>
          <div v-if="knowledgeHint" class="sub">{{ knowledgeHint }}</div>
        </div>
      </template>
      <span v-else class="hint">请从左侧选择角色</span>
    </div>

    <div class="header-actions">
      <button
        class="header-btn"
        :class="knowledgeButtonClass"
        @click="$emit('toggle-knowledge-drawer')"
        :aria-pressed="knowledgeDrawerOpen"
        aria-label="打开知识库挂载"
      >
        <BookOpenIcon :size="15" aria-hidden="true" />
        <span>{{ knowledgeButtonLabel }}</span>
      </button>
      <button
        v-if="persona"
        class="header-btn header-btn--feature"
        :class="{ active: mode === 'digital-human' }"
        :aria-pressed="mode === 'digital-human'"
        :aria-label="mode === 'digital-human' ? '关闭数字人播报' : '开启数字人播报'"
        :title="mode === 'digital-human' ? '关闭数字人播报，回到标准问答' : '开启数字人播报，以数字人方式展示回答'"
        @click="$emit('change-mode', mode === 'digital-human' ? 'voice' : 'digital-human')"
      >
        <BotIcon :size="15" aria-hidden="true" />
        <span>{{ mode === 'digital-human' ? '退出数字人' : '数字人模式' }}</span>
      </button>
      <button
        v-if="persona"
        class="header-btn header-btn--ghost"
        @click="$emit('new-conversation')"
        aria-label="新建对话"
        title="新建对话（清空当前会话）"
      >
        <PlusSquareIcon :size="15" aria-hidden="true" />
        <span>新对话</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenIcon, BotIcon, PlusSquareIcon } from 'lucide-vue-next'

const props = defineProps({
  persona: { type: Object, default: null },
  knowledgeDrawerOpen: { type: Boolean, default: false },
  mode: { type: String, default: 'voice' },
  knowledgeSummary: { type: String, default: '' },
  knowledgeSummaryCompact: { type: String, default: '' },
  knowledgeSummaryTone: { type: String, default: 'default' },
})

defineEmits(['toggle-knowledge-drawer', 'change-mode', 'new-conversation'])

const knowledgeButtonLabel = computed(() => {
  if (!props.persona) return '知识范围'
  if (props.knowledgeSummaryTone === 'warning') return '先挂载知识库'
  return '知识范围'
})

const knowledgeButtonClass = computed(() => ({
  active: props.knowledgeDrawerOpen,
  'header-btn--primary': props.knowledgeSummaryTone === 'active' || props.knowledgeDrawerOpen,
  'header-btn--warning': props.knowledgeSummaryTone === 'warning' && !props.knowledgeDrawerOpen,
}))

const summaryClass = computed(() => ({
  'summary-pill--warning': props.knowledgeSummaryTone === 'warning',
  'summary-pill--active': props.knowledgeSummaryTone === 'active',
}))

const knowledgeHint = computed(() => {
  if (props.knowledgeSummaryCompact) return ''
  if (props.knowledgeSummaryTone !== 'warning') return ''
  return props.knowledgeSummary
})
</script>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  min-height: 52px;
}

.persona-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.persona-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hint {
  font-size: 13px;
  color: var(--text-muted);
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #87b4ff, #1f6feb);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.name {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-pill {
  min-width: 0;
  max-width: min(32vw, 300px);
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.summary-pill span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-pill--active {
  background: var(--primary-bg);
  border-color: rgba(191, 219, 254, 0.9);
  color: var(--primary);
}

.summary-pill--warning {
  background: #fff7ed;
  border-color: rgba(251, 191, 36, 0.34);
  color: #b45309;
}

.sub {
  font-size: 11px;
  color: #b45309;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(44vw, 420px);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

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

.header-btn:hover {
  background: var(--primary-bg);
  border-color: var(--primary-muted);
  color: var(--primary);
}

.header-btn.active {
  background: var(--primary-bg);
  border-color: var(--primary);
  color: var(--primary);
}

.header-btn--primary {
  background: var(--primary-bg);
  border-color: var(--primary-muted);
  color: var(--primary);
}

.header-btn--warning {
  background: #fff7ed;
  border-color: rgba(251, 191, 36, 0.42);
  color: #b45309;
}

.header-btn--warning:hover {
  background: #ffedd5;
  border-color: #f59e0b;
  color: #9a3412;
}

.header-btn--feature {
  color: var(--text-muted);
  border-style: dashed;
}

.header-btn--ghost {
  color: var(--text-muted);
}

@media (max-width: 960px) {
  .chat-header {
    padding: 8px 12px;
  }

  .summary-pill {
    max-width: 180px;
  }

  .header-btn {
    padding: 6px 10px;
  }

  .header-actions {
    gap: 8px;
  }
}

@media (max-width: 720px) {
  .chat-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .summary-pill {
    max-width: min(58vw, 240px);
  }
}
</style>
