<template>
  <article class="metric-card" :class="{ 'metric-card--warn': warn }">
    <div class="metric-card__head">
      <span class="metric-card__label">{{ label }}</span>
      <component :is="icon" v-if="icon" :size="15" class="metric-card__icon" />
    </div>
    <strong class="metric-card__value">{{ value }}</strong>
    <small v-if="hint" class="metric-card__hint">{{ hint }}</small>
    <slot />
  </article>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  label: string
  value: string | number
  hint?: string
  icon?: Component
  warn?: boolean
}>()
</script>

<style scoped>
.metric-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.035);
  text-align: left;
  transition: all 0.2s ease;
}

.metric-card--warn {
  border-color: rgba(245, 158, 11, 0.32);
  background: rgba(255, 251, 235, 0.55);
}

.metric-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.metric-card__label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.metric-card__icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.metric-card__value {
  color: var(--text);
  font-size: 24px;
  font-weight: 800;
  line-height: 1;
}

.metric-card__hint {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
