<template>
  <nav class="persona-panel" aria-label="角色列表">
    <div class="panel-header">
      <BotIcon :size="16" color="var(--primary)" aria-hidden="true" />
      <span class="logo">数字人 Agent</span>
    </div>

    <div class="section-label">角色</div>

    <ul class="persona-list" role="listbox" aria-label="选择角色">
      <PersonaItem
        v-for="p in personas"
        :key="p.id"
        :persona="p"
        :active="selectedId === p.id"
        @select="$emit('select', $event)"
      />
      <li v-if="!personas.length" class="empty-hint" role="status">
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
})
defineEmits(['select'])
</script>

<style scoped>
.persona-panel {
  width: 236px;
  flex-shrink: 0;
  background: var(--primary-bg);
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
.logo { font-size: 14px; font-weight: 700; color: var(--primary); letter-spacing: -0.02em; }
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
</style>
