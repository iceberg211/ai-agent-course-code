<template>
  <nav class="persona-panel" aria-label="角色列表">
    <div class="panel-header">
      <BotIcon :size="16" color="var(--primary)" aria-hidden="true" />
      <span class="logo">数字人 Agent</span>
    </div>

    <div class="section-label">角色</div>

    <ul class="persona-list" role="listbox" aria-label="选择角色">
      <template v-if="loading">
        <li v-for="i in 4" :key="`skeleton-${i}`" class="persona-skeleton" aria-hidden="true">
          <span class="skeleton-avatar" />
          <span class="skeleton-lines">
            <span class="line line-main" />
            <span class="line line-sub" />
          </span>
        </li>
      </template>
      <template v-else>
        <PersonaItem
          v-for="p in personas"
          :key="p.id"
          :persona="p"
          :active="selectedId === p.id"
          @select="$emit('select', $event)"
          @delete="$emit('delete', $event)"
        />
      </template>
      <li v-if="!loading && !personas.length" class="empty-hint" role="status">
        <UserIcon :size="16" color="var(--text-muted)" aria-hidden="true" />
        <span>暂无角色</span>
      </li>
    </ul>

    <div class="panel-footer">
      <ConnectionStatus :connected="connected" />
    </div>
  </nav>
</template>

<script setup>
import { BotIcon, UserIcon } from 'lucide-vue-next'
import PersonaItem from './PersonaItem.vue'
import ConnectionStatus from './ConnectionStatus.vue'

defineProps({
  personas:   { type: Array,   default: () => [] },
  selectedId: { type: String,  default: '' },
  connected:  { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
})
defineEmits(['select', 'delete'])
</script>

<style scoped>
.persona-panel {
  width: 236px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #f7faff, #f2f7ff);
  border-right: 1px solid var(--border-muted);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--border-muted);
}
.logo { font-size: 14px; font-weight: 700; color: var(--text-secondary); letter-spacing: -0.02em; }
.section-label {
  padding: 14px 16px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  text-transform: uppercase;
}
.persona-list { flex: 1; overflow-y: auto; padding: 4px 8px; list-style: none; }
.empty-hint { display: flex; align-items: center; gap: 8px; padding: 16px; color: var(--text-muted); font-size: 12px; list-style: none; }
.panel-footer { padding: 12px 16px; border-top: 1px solid var(--border-muted); }
.persona-skeleton {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  list-style: none;
}
.skeleton-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(90deg, #e8f0ff 20%, #dbe8ff 45%, #e8f0ff 75%);
  background-size: 260% 100%;
  animation: shimmer 1.3s linear infinite;
}
.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.line {
  display: block;
  height: 9px;
  border-radius: 6px;
  background: linear-gradient(90deg, #edf3ff 20%, #dbe8ff 45%, #edf3ff 75%);
  background-size: 260% 100%;
  animation: shimmer 1.3s linear infinite;
}
.line-main { width: 72%; }
.line-sub { width: 52%; }

@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (max-width: 960px) {
  .persona-panel {
    width: 84px;
  }
  .panel-header {
    justify-content: center;
    padding: 14px 10px;
  }
  .logo,
  .section-label {
    display: none;
  }
  .persona-list {
    padding: 8px 6px;
  }
  .empty-hint {
    justify-content: center;
    padding: 10px 4px;
  }
  .empty-hint span {
    display: none;
  }
  .panel-footer {
    padding: 10px 8px;
  }
}
</style>
