<template>
  <article
    class="flex flex-col gap-1.5 p-4 px-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-lg shadow-card text-left min-w-0 transition-all duration-200"
    :class="warn ? 'border-amber-500/32 bg-amber-50/40' : ''"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] font-bold text-text-muted">{{ label }}</span>
      <component :is="icon" v-if="icon" :size="15" class="text-text-muted shrink-0" />
    </div>
    <strong class="text-2xl leading-none text-text-main font-extrabold">{{ value }}</strong>
    <small v-if="hint" class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">
      {{ hint }}
    </small>
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
