<template>
  <div class="error-state" role="alert">
    <AlertCircleIcon :size="32" class="error-state__icon" />
    <p class="error-state__title">{{ title }}</p>
    <p v-if="description" class="error-state__desc">{{ description }}</p>
    <button
      v-if="retryLabel"
      class="error-state__retry"
      type="button"
      @click="$emit('retry')"
    >
      {{ retryLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { AlertCircleIcon } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    title?: string
    description?: string
    retryLabel?: string
  }>(),
  {
    title: '加载失败',
    description: '请检查后端服务状态后重试。',
    retryLabel: '重新加载',
  },
)

defineEmits<{
  (e: 'retry'): void
}>()
</script>

<style scoped>
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 240px;
  padding: 48px 32px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
  text-align: center;
}

.error-state__icon {
  color: var(--error);
}

.error-state__title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
}

.error-state__desc {
  margin: 0;
  max-width: 420px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.error-state__retry {
  margin-top: 4px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.error-state__retry:hover {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
}
</style>
