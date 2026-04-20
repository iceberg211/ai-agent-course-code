<template>
  <li
    class="persona-item"
    :class="{ active }"
    role="option"
    :aria-selected="active"
    tabindex="0"
    @click="$emit('select', persona.id)"
    @keydown.enter="$emit('select', persona.id)"
    @keydown.space.prevent="$emit('select', persona.id)"
  >
    <div class="avatar" aria-hidden="true">{{ persona.name[0] }}</div>
    <div class="info">
      <div class="name">{{ persona.name }}</div>
      <div class="desc">{{ persona.description || '暂无简介' }}</div>
    </div>
    <button
      class="delete-btn"
      type="button"
      :aria-label="`删除角色 ${persona.name}`"
      @click.stop="emit('delete', persona.id)"
    >
      <Trash2Icon :size="13" aria-hidden="true" />
    </button>
    <CheckIcon v-if="active" :size="13" color="var(--primary)" aria-hidden="true" class="active-mark" />
  </li>
</template>

<script setup lang="ts">
import { CheckIcon, Trash2Icon } from 'lucide-vue-next'
import type { Persona } from '@/types'

withDefaults(defineProps<{
  persona: Persona
  active?: boolean
}>(), {
  active: false,
})

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'delete', id: string): void
}>()
</script>

<style scoped>
.persona-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background-color 150ms ease-out, border-color 150ms ease-out;
  user-select: none;
  list-style: none;
}
.persona-item:hover { background: var(--surface-soft); }
.persona-item.active { background: var(--primary-bg); border-left-color: var(--primary); }

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #87b4ff, #1f6feb);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}
.info { flex: 1; overflow: hidden; }
.name { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desc { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.active-mark {
  flex-shrink: 0;
}
.delete-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out;
}
.persona-item:hover .delete-btn,
.persona-item:focus-within .delete-btn {
  opacity: 1;
}
.delete-btn:hover {
  color: var(--error);
  background: #fee2e2;
}

@media (max-width: 960px) {
  .persona-item {
    justify-content: center;
    padding: 8px 6px;
    border-left: none;
  }
  .info,
  .active-mark,
  .delete-btn {
    display: none;
  }
}
</style>
