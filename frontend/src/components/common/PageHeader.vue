<template>
  <header class="page-header">
    <div class="page-header__main">
      <span v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  eyebrow?: string
}>()
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  text-align: left;
}

.page-header__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.page-header__eyebrow {
  color: var(--primary);
  font-size: 11px;
  font-weight: 800;
}

.page-header h1 {
  margin: 0;
  color: var(--text);
  font-size: 22px;
  font-weight: 850;
  line-height: 1.2;
  letter-spacing: 0;
}

.page-header p {
  margin: 0;
  max-width: 760px;
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.page-header__actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .page-header {
    flex-direction: column;
  }

  .page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
