<template>
  <div
    class="flex flex-col items-center justify-center gap-3 p-16 text-center text-text-muted text-xs bg-white/65 rounded-xl border border-dashed border-border-main"
    role="status"
  >
    <component :is="icon" v-if="icon" :size="28" class="text-text-muted opacity-60" />
    <p class="m-0 text-sm font-bold text-text-secondary">{{ title }}</p>
    <p v-if="description" class="m-0 max-w-md leading-relaxed">{{ description }}</p>
    <div v-if="$slots.actions" class="mt-1">
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
