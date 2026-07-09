<template>
  <div class="empty-state" role="status">
    <component :is="icon" v-if="icon" :size="28" class="empty-state__icon" />
    <p class="empty-state__title">{{ title }}</p>
    <p v-if="description" class="empty-state__desc">{{ description }}</p>
    <div v-if="$slots.actions" class="empty-state__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  title: string
  description?: string
  icon?: Component
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 220px;
  padding: 48px 32px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.65);
  color: var(--text-muted);
  text-align: center;
  font-size: 12px;
}

.empty-state__icon {
  color: var(--text-muted);
  opacity: 0.6;
}

.empty-state__title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
}

.empty-state__desc {
  margin: 0;
  max-width: 420px;
  line-height: 1.6;
}

.empty-state__actions {
  margin-top: 4px;
}
</style>
