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
    <CheckIcon v-if="active" :size="13" color="var(--primary)" aria-hidden="true" />
  </li>
</template>

<script setup>
import { CheckIcon } from 'lucide-vue-next'
defineProps({
  persona: { type: Object, required: true },
  active:  { type: Boolean, default: false },
})
defineEmits(['select'])
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
  transition: background 150ms ease-out;
  user-select: none;
  list-style: none;
}
.persona-item:hover { background: rgba(124,58,237,0.06); }
.persona-item.active { background: rgba(124,58,237,0.08); border-left-color: var(--primary); }

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #C4B5FD, #7C3AED);
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
</style>
