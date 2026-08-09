<template>
  <section class="filter-bar" :aria-label="label">
    <div class="filter-bar__grid">
      <slot />
    </div>
    <div v-if="$slots.actions" class="filter-bar__actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: '筛选面板',
  },
)
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(12px);
}

.filter-bar__grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 14px;
}

.filter-bar__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (min-width: 768px) {
  .filter-bar__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .filter-bar__grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
